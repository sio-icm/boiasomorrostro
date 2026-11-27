"""A short video of the 3D view, made again every quarter of an hour, for screens too slow to run the app
itself (a TV at a school's reception, for instance): played by video/index.html.

A headless Chrome keeps the app open. The server has no graphics card, so it draws a few images
per second at most: instead of filming it as it goes, the clock of its animation (the time given
to requestAnimationFrame and performance.now, not the date, so the data shown are now's) is moved
on by hand, one video frame at a time, and each frame is taken once drawn. The video then plays
smoothly whatever it took to make. Between videos the clock stands still and nothing is drawn.

    python3 video_recorder.py

Settings, in the environment or .env (see read_env):
    VIDEO_PAGE_URL   the page filmed (the app with its data panel hidden)
    VIDEO_DIR        where latest.mp4 and latest.jpg (its first frame) are written
    VIDEO_SECONDS    length of each video (10)
    VIDEO_EVERY      seconds from the start of one to the next (900), or as soon as possible if
                     making it takes longer
    VIDEO_WIDTH, VIDEO_HEIGHT, VIDEO_FPS   1280 x 720, 25
    VIDEO_LANGUAGE   the app's language (es-ES)
    CHROME, FFMPEG   the programs, if not found by those names
Needs Chrome or Chromium, ffmpeg and websockets.
"""
import asyncio
import base64
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

import websockets


def read_env(name, default=None):
    """A setting from the environment, else from the .env next to this file"""
    if os.environ.get(name):
        return os.environ[name]
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')) as f:
            for line in f:
                key, _, value = line.strip().partition('=')
                if key == name and value:
                    return value.strip().strip('"\'')
    except OSError:
        pass
    return default


PAGE_URL = read_env('VIDEO_PAGE_URL', 'https://iot.icm.csic.es/boiasomorrostro/#PANEL=hidden')
OUT_DIR = read_env('VIDEO_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'video'))
SECONDS = float(read_env('VIDEO_SECONDS', 10))
EVERY = float(read_env('VIDEO_EVERY', 900))
WIDTH, HEIGHT = int(read_env('VIDEO_WIDTH', 1280)), int(read_env('VIDEO_HEIGHT', 720))
FPS = int(read_env('VIDEO_FPS', 25))
CHROME = read_env('CHROME') or next((c for c in ('google-chrome', 'chromium', 'chromium-browser') if shutil.which(c)), 'google-chrome')
FFMPEG = read_env('FFMPEG', 'ffmpeg')
LANGUAGE = read_env('VIDEO_LANGUAGE', 'es-ES')
PORT = 9333
LOAD_SECONDS = 300  # At most, for the app to load (its 3D view running), and then some more
SETTLE_SECONDS = 30
RELOAD_HOURS = 6  # The browser started again this often, so it does not grow


# The animation's clock, by hand (before the app's own scripts): while held, requestAnimationFrame
# only queues and performance.now stands still; step(ms) moves it on and draws one frame
CLOCK = """
(() => {
  const realNow = performance.now.bind(performance), realFrame = window.requestAnimationFrame.bind(window);
  let held = false, now = 0, queue = [], id = 1e9;
  performance.now = () => held ? now : realNow();
  window.requestAnimationFrame = (callback) => {
    if (!held) return realFrame(callback);
    queue.push(callback);
    return ++id;
  };
  window.__videoClock = {
    hold() { if (!held) { now = realNow(); held = true; } },
    step(ms) {
      now += ms;
      const callbacks = queue;
      queue = [];
      callbacks.forEach(callback => { try { callback(now); } catch (error) { console.error(error); } });
      return callbacks.length;
    },
  };
})();
"""


class Browser:
    """A headless Chrome and one of its pages, through the DevTools protocol"""

    async def start(self):
        self.profile = tempfile.mkdtemp(prefix='boia-video-')
        self.process = subprocess.Popen(
            [CHROME, '--headless=new', f'--remote-debugging-port={PORT}', f'--user-data-dir={self.profile}',
             '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
             f'--window-size={WIDTH},{HEIGHT}', '--hide-scrollbars', '--mute-audio', '--no-first-run',
             '--no-default-browser-check', f'--lang={LANGUAGE}', f'--accept-lang={LANGUAGE}', '--disable-background-timer-throttling',
             '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            await asyncio.sleep(0.2)
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json', timeout=2) as res:
                    page = next(t for t in json.loads(res.read()) if t['type'] == 'page')
                break
            except (OSError, StopIteration, ValueError):
                continue
        else:
            raise RuntimeError(f'{CHROME} did not start')
        self.ws = await websockets.connect(page['webSocketDebuggerUrl'], max_size=None, ping_interval=None)
        self.next_id = 0
        await self.call('Page.enable')
        await self.call('Emulation.setDeviceMetricsOverride', width=WIDTH, height=HEIGHT, deviceScaleFactor=1, mobile=False)
        await self.call('Emulation.setLocaleOverride', locale=LANGUAGE)
        await self.call('Page.addScriptToEvaluateOnNewDocument', source=CLOCK)
        await self.call('Page.navigate', url=PAGE_URL)
        self.started = time.time()

    async def loaded(self):
        """Once the app's 3D view runs (see SceneManager), and some more for its models and data"""
        for _ in range(LOAD_SECONDS // 5):
            await asyncio.sleep(5)
            if await self.evaluate('!!(window.sceneManager && document.readyState == "complete")'):
                await asyncio.sleep(SETTLE_SECONDS)
                return
        raise RuntimeError('the app did not load')

    async def call(self, method, **params):
        self.next_id += 1
        await self.ws.send(json.dumps({'id': self.next_id, 'method': method, 'params': params}))
        while True:
            message = json.loads(await asyncio.wait_for(self.ws.recv(), 60))
            if message.get('id') == self.next_id:
                if 'error' in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get('result', {})

    async def evaluate(self, expression):
        result = await self.call('Runtime.evaluate', expression=expression, returnByValue=True, awaitPromise=True)
        return result.get('result', {}).get('value')

    async def stop(self):
        try:
            await self.ws.close()
        except Exception:
            pass
        self.process.terminate()
        try:
            self.process.wait(10)
        except subprocess.TimeoutExpired:
            self.process.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


async def record(browser):
    """One video: its frames taken one by one, then made into latest.mp4 (replaced at once)"""
    os.makedirs(OUT_DIR, exist_ok=True)
    frames = tempfile.mkdtemp(prefix='frames-', dir=OUT_DIR)
    try:
        await browser.evaluate('window.__videoClock.hold()')
        for i in range(round(SECONDS * FPS)):
            await browser.evaluate(f'window.__videoClock.step({1000 / FPS})')
            shot = await browser.call('Page.captureScreenshot', format='jpeg', quality=88)
            with open(os.path.join(frames, f'{i:05d}.jpg'), 'wb') as f:
                f.write(base64.b64decode(shot['data']))
        video = os.path.join(OUT_DIR, 'latest.tmp.mp4')
        subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(frames, '%05d.jpg'),
                        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
                        '-movflags', '+faststart', video], check=True)
        poster = os.path.join(OUT_DIR, 'latest.tmp.jpg')
        shutil.copyfile(os.path.join(frames, '00000.jpg'), poster)
        os.replace(video, os.path.join(OUT_DIR, 'latest.mp4'))
        os.replace(poster, os.path.join(OUT_DIR, 'latest.jpg'))
    finally:
        shutil.rmtree(frames, ignore_errors=True)


async def main():
    print(f'🎬 Filming {PAGE_URL} into {OUT_DIR}: {SECONDS:g} s every {EVERY:g} s, {WIDTH}x{HEIGHT} at {FPS} fps', flush=True)
    browser = None
    while True:
        try:
            if browser is None or time.time() - browser.started > RELOAD_HOURS * 3600:
                if browser:
                    await browser.stop()
                browser = Browser()
                await browser.start()
                await browser.loaded()
            began = time.time()
            await record(browser)
            print(f'✅ Video made in {time.time() - began:.0f} s', flush=True)
            # The next one at the start of the next minute (EVERY), or at once if late
            await asyncio.sleep(max(0, EVERY - time.time() % EVERY))
        except Exception as error:
            print('❌ Video not made:', repr(error), flush=True)
            if browser:
                await browser.stop()
            browser = None
            await asyncio.sleep(30)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    asyncio.run(main())
