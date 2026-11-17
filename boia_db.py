"""The SIO's database: PostgreSQL with PostGIS (deploy/postgres), where the app's data sources are
kept together. Its address in DATABASE_URL (environment or .env next to this script), e.g.
postgresql://boia:<password>@localhost:5432/boia. Needs psycopg 3 (deploy/requirements.txt).
"""
import os

SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'deploy', 'postgres', 'schema.sql')


def read_env(name):
    value = os.environ.get(name)
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not value and os.path.exists(env_path):
        with open(env_path) as env:
            for line in env:
                key, _, found = line.strip().partition('=')
                if key == name:
                    value = found.strip()
    return value


def connect():
    """A connection (autocommit) with the tables created, or None if there is no DATABASE_URL"""
    url = read_env('DATABASE_URL')
    if not url:
        return None
    import psycopg  # Only needed with a database
    db = psycopg.connect(url, autocommit=True, connect_timeout=5)
    with open(SCHEMA) as file:
        db.execute(file.read())
    return db
