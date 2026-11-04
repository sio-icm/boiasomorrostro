let en;
export default en = {
  "Date": "Date",
  "Longitude": "Longitude",
  "Latitude": "Latitude",
  "Time step": "Time step",



  "Raw data": "Raw data",
  "Data": "Data",
  "Data from": "Data from",
  "above water": "above water",
  "below water": "below water",


  "About": "About",
  "intro": "This application offers a dynamic 3D visualization of the Somorrostro buoy, mirroring its actual conditions and providing access to live meteorological and oceanographic data.",
  "disclaimer": "The data presented in this application is for informational purposes only. While we strive to ensure accuracy and reliability, we cannot guarantee that the data is free from errors or interruptions. The information should not be used for critical decision-making without additional verification. Use of the application is at your own risk.",
  "concept": "The concept of this web application originates from digital twins: the sea state shown here should be a replica of the real sea. Additionally, the user should be able to change the digital twin and create 'what-if scenarios'.",
  "howtocite": "If you want to reference this web application please use the folling citations:",

  "Contact": "Contact",
  "author-info-gerard": "For any questions, comments, or suggestions regarding the web application, you can contact ",
  "contact-github-issues": "If you are familiar with GitHub issues, you can report errors through ",
  "author-info-jordi": "For questions regarding the data, its processing, and acquisition, contact ",
  "contact-icatmar": "For anything else, you can contact us through ",


  "Map": "Map",
  "Somorrostro buoy": "Somorrostro buoy",

  "buoyButtonTitle": "Center the camera on the surface buoy",
  "baseButtonTitle": "Center the camera on the underwater observatory",

  "information": "Information",
  "githubButton": "Open source repository",
  "languageButton": "Change the language",

  "waveButtonTitle": "Set the ocean swell",
  "windButtonTitle": "Set the wind",

  "externalDataButton": "Connect with external data",

  "externalLinkButton": "Go to the data source",
  "measuresButton": "Open/Close the data panel",

  "compassButtonTitle": "Set the camera facing north",


  "WSPD": "Wind speed",
  "WDIR": "Wind direction",
  "Hm0": "Wave height (average)",
  "Hmax": "Wave maximum height",
  "Mdir": "Wave direction (average)",
  "Spr1": "Wave directional spreading",
  "AIRT": "Air temperature",
  "TEMP": "Temperature (underwater base)",
  "PSAL": "Salinity (underwater base)",

  "Wind": "Wind",
  "Waves": "Waves",

  "Wave height": "Wave height",
  "Swell direction": "Swell direction",
  "Wave direction": "Mean wave direction",
  "Wave steepness": "Wave steepness",
  "Wave period": "Wave period",

  "Swell composition": "Swell composition",
  "Swell composition legend": "Swell composition legend",

  "Wind wave direction": "Wind wave direction",
  "Wind wave significant height": "Wind wave",
  "Primary swell wave direction": "Primary swell direction",
  "Primary swell wave significant height": "Primary swell",
  "Secondary swell wave direction": "Secondary swell direction",
  "Secondary swell wave significant height": "Secondary swell",

  "Sea current direction": "Current direction",
  "Sea surface velocity": "Current",
  "Sea water velocity": "Current",
  "Chlorophyll": "Chlorophyll",

  "Wind speed": "Wind",
  "Wind direction": "Wind direction",
  "Wind gust": "Gust",
  "Wave significant height": "Waves",
  "Air temperature": "Air temp.",
  "Sea temperature (0.5m)": "Water temp. (0.5m)",
  "Sea temperature (4m)": "Water temp. (4m)",
  "Atmospheric pressure": "Pressure",
  "Sea surface temperature": "Sea temp.",
  "Sea bottom temperature": "Sea bottom temperature",
  "Sea temperature anomaly": "Sea temperature anomaly",
  "Salinity": "Salinity",
  "Humidity": "Humidity",
  "Cloudiness": "Cloudiness",

  // Buoy METEO sensor, shortened for the data timeline
  "Dew point temperature": "Dew point",
  "Wet bulb temperature": "Wet bulb",
  "Relative wind speed": "Rel. wind",
  "Relative wind direction": "Rel. wind direction",
  "Corrected wind direction": "Corrected wind dir. (mag.)",
  "Air density": "Air density",

  // Buoy CTD/SAMI sensors, shown in the extended observations view
  "Dissolved oxygen": "Dissolved oxygen",
  "Sea pressure": "Water pressure",
  "Electrical conductivity": "Electrical cond.",
  "Water pH": "Water pH",

  // Bottom section
  "Forecast": "Forecast",
  "Observations": "Observations",

  // Map
  "Bathymetry": "Bathymetry",
  "Light map": "Light map",
  "Nautical marks": "Nautical marks",
  "Isobaths": "Isobaths",
  "Wind forecast": "Wind forecast",
  "Currents forecast": "Currents forecast",
  "Sea temperature forecast": "Sea temperature forecast",
  "Currents": "Currents",
  "Sea temperature": "Sea temperature",
  "Last data": "Last data",
  "See observations": "See observations",
  "Loading": "Loading",
  "No data": "No data",
  "Ships": "Ships",
  "Cargo": "Cargo",
  "Tanker": "Tanker",
  "Passenger": "Passenger",
  "High speed craft": "High speed craft",
  "Fishing": "Fishing",
  "Recreational": "Recreational",
  "Service vessel": "Port service",
  "Other": "Other",
  "Aid to navigation": "Aid to navigation",
  "Speed": "Speed",
  "Heading": "Heading",
  "Size": "Length × beam",

  timeAgo: {
    now: "Just now",
    minutes: "{n} min ago",
    hour: "1h ago",
    hours: "{n}h ago",
    day: "1 day ago",
    days: "{n} days ago",
    moreThanWeek: "More than 7 days ago",
  },

  buoyStatus: {
    noData: "No data available from the buoy in the last three days.",
    tooManyRequests: "Too many requests to the data server right now. Please try again in a moment.",
    serverError: "The data server is currently unavailable.",
    timeout: "The data server took too long to respond.",
    genericError: "Could not reach the data server.",
    contactPrefix: "If you need this information urgently, please contact",
  },

  "swellCompositionSVG": "Light blue: mean wave height; Yellow: wind waves; Blue: primary swell; Dark blue: secondary swell",

  infoPanel: {
    title: "About",
    p1: `This application is a 3D simulation of the meteorological and oceanographic conditions 
        of the seafloor observatory OBSEA. The simulation is based on the data collected by the 
        observatory when available. The objective of this application is to transfer the knowledge
        and information acquiered by the observatory. This application is being developed by the
        `,
    p1_1: `in collaboration with`,
    BlueNetCat: 'Catalan Maritime Network (BlueNetCat)',
    OBSEA_UPC: 'OBSEA from Universitat Politècnica de Catalunya(UPC)',
    p1_2: `. Special thanks to the Technologies Interactive Group (GTI) at Universitat Pompeu Fabra
    for the technical support and to Emilio García for the theorical support. The code for the 
    application can be found in the `,
    github: `github repository.`,

    aboutObsea: `About OBSEA`,
    p2: `Taken from OBSEA website: "Everyday experimental marine research needs a greater volume 
    of environmental data with better resolution than what can be collected using oceanographic vessels, 
    buoys, or sensors deployed on the seabed. The seafloor observatories can acquire data with great resolution 
    uninterruptedly during long time periods. With this information, scientific community is able to analyze as 
    well annual tendencies as singular events.`,
    p2_1: `The OBSEA underwater observatory (www.obsea.es) is connected with 4 km of cable to the coast of 
    Vilanova i la Geltrú (Barcelona, Spain) and placed at a depth of 20 meters in a fishing protected area.
    The main advantage of the cabled observatory is the capacity to feed the station from land with up to 3.6kW 
    and the high bandwidth communication link of 1 Gbps. This link gives the information in real time and avoids 
    the drawbacks of battery powered systems. The implemented solution is an optical ethernet network that continuously
     transmits data from the connected oceanographic instruments. With OBSEA we can observe in real-time multiple 
     parameters of the marine environment. The Ground Station provides power to feed all the devices and the fiber 
     optic link to establish communications. At the same time from land we manage alarms and data storage. With a 
     length of 1000 meters the terrestrial cable connects the Ground Station to the Beach Manhole where the submarine
      cable begins its route to the node location at 4 km from the coast and 20 meters deep."`,

    contact: "Contact",
    p3: `For inquiries about the application, please contact Gerard Llorach (gllorach at bluenetcat.eu).
     For inquiries about the data, please contact Enoc Martínez (enoc.martinez at upc.edu ).`,

    funding: "Funding",
    p4: `The Catalan Maritime Network (BlueNetCat) is financed by 
    the Generalitat de Catalunya and by the European Regional Development Fund (ERDF).`,

  },


  seaPanel: {
    title: "Sea simulation parameters",
    p1: "This simulation is made with Gestner waves, following the",
    p1_1: "tutorial by Jasper Flick",
    p2: `The simulation generates the parameters of 16 waves according to wave measurements, such as the mean
          wave height, the maximum wave height and the direction of the swell.`,
    oceanSteepness: "Set ocean chopiness",
    waveSignificantHeight: "Set wave significant height",
    meanWaveDirection: "Set the average direction of the waves",
    swellParams: "Set swell parameters",
  },

  windPanel: {
    title: "Wind simulation parameters",
    p1: "The cloth simulation is using verlet integration (Hitman's ragdoll), following the",
    p1_1: "tutorial by Jared Counts",
    p2: `The simulation is based on the wind speed and direction measurements, which modify
        the forces affecting the cloth.`,
    windParams: 'Set wind parameters',
  },


  externalDataCMEMS: {
    title: "Wave data and other parameters",
    p1: `Data are downloaded using the Copernicus service. 
    In the following table you will be able to see data from previous and posterior days from the selected date (today by default). 
    The data comes from models and not from observations.`,
    generatedCMEMS: "Generated using E.U. Copernicus Marine Service Information: ",
    datesModify: "Change the dates",
  }, 

  "More data": "+ Data",
  "Regenerate ocean": "↻ Regenerate simulation",

  timeControl: {
    "timeSliderTip": "Drag to select the date",
    "dailyMax": "Daily maximum (OBSEA)",
    "halfHourly": "30min average (OBSEA)",
    "playPause": "Play/Pause",
    "stepForward": "Step forward",
    "stepBackward": "Step backward",
    "forward": "Fast-forward",
    "backward": "Rewind"
  },
  
  

}