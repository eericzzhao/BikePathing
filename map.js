// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';


// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

mapboxgl.accessToken = 'pk.eyJ1IjoiZTN6aGFvIiwiYSI6ImNtcDY4bTloYzAwbTUyeG9oeGhsanA2NTUifQ.SApG6HffET7E_mhctGjCEQ''

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map', // container ID
    style: 'mapbox://styles/mapbox/streets-v12', // style URL
    center: [-71.09415, 42.36027], //[longtitude, latitute]
    zoom: 12, // Initial zoom level
    minZoom: 5, // Minimum allowed zoom
    maxZoom: 18, // Maximum allowed zoom
});

// Create 1440 buckets (one for each minute of the day)
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes); 
    return date.toLocaleString('en-US', { timeStyle: 'short' }); 
}

// Efficiently retrieve only the trips within the 120-minute window
function filterByMinute(tripsByMinute, minute) {
    if (minute === -1) {
      return tripsByMinute.flat(); // No filtering, return all trips
    }
  
    let minMinute = (minute - 60 + 1440) % 1440;
    let maxMinute = (minute + 60) % 1440;
  
    if (minMinute > maxMinute) {
      let beforeMidnight = tripsByMinute.slice(minMinute);
      let afterMidnight = tripsByMinute.slice(0, maxMinute);
      return beforeMidnight.concat(afterMidnight).flat();
    } else {
      return tripsByMinute.slice(minMinute, maxMinute).flat();
    }
}

function computeStationTraffic(stations, timeFilter = -1) {
    // Retrieve filtered trips efficiently from the buckets
    const departures = d3.rollup(
      filterByMinute(departuresByMinute, timeFilter),
      (v) => v.length,
      (d) => d.start_station_id
    );
  
    const arrivals = d3.rollup(
      filterByMinute(arrivalsByMinute, timeFilter),
      (v) => v.length,
      (d) => d.end_station_id
    );
  
    // Update station data with filtered counts
    return stations.map((station) => {
        let newStation = { ...station }; 
        let id = newStation.short_name;
        
        newStation.arrivals = arrivals.get(id) ?? 0;
        newStation.departures = departures.get(id) ?? 0;
        newStation.totalTraffic = newStation.arrivals + newStation.departures;
        
        return newStation;
    });
}

map.on('load', async () => {
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });
    map.addLayer({
        id: 'boston-bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: {
            'line-color': '#32D400',  
            'line-width': 5,          
            'line-opacity': 0.6       
        }
    });

    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
    });
    map.addLayer({
        id:'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: {
            'line-color': '#32D400', 
            'line-width': 5,         
            'line-opacity': 0.6       
        }
    });

    try {
        const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
        
        // 1. FIX: Add trips to the buckets as soon as they download!
        let trips = await d3.csv(
            'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
            (trip) => {
                trip.started_at = new Date(trip.started_at);
                trip.ended_at = new Date(trip.ended_at);

                let startedMinutes = minutesSinceMidnight(trip.started_at);
                departuresByMinute[startedMinutes].push(trip);

                let endedMinutes = minutesSinceMidnight(trip.ended_at);
                arrivalsByMinute[endedMinutes].push(trip);

                return trip;
            },
        );

        const jsonData = await d3.json(jsonurl);
        
        // 2. FIX: We no longer need to pass 'trips' to this function
        let stations = computeStationTraffic(jsonData.data.stations); 
        
        console.log('Loaded JSON Data:', jsonData); 
        console.log('Station array with traffic: ', stations);

        const radiusScale = d3
            .scaleSqrt()
            .domain([0, d3.max(stations, (d) => d.totalTraffic)])
            .range([0, 25]);

        let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

        const svg = d3.select('#map').select('svg');

        function getCoords(station) {
            const point = new mapboxgl.LngLat(+station.lon, +station.lat); 
            const { x, y } = map.project(point); 
            return { cx: x, cy: y }; 
        }

        const circles = svg
            .selectAll('circle')
            .data(stations, (d) => d.short_name)
            .enter()
            .append('circle')
            .attr('r', (d) => radiusScale(d.totalTraffic)) 
            .attr('stroke', 'white') 
            .attr('stroke-width', 1) 
            .attr('opacity', 0.8) 
            .style('--departure-ratio', d => stationFlow(d.totalTraffic === 0 ? 0.5 : d.departures / d.totalTraffic))            
            .each(function (d) {
                d3.select(this)
                    .append('title') 
                    .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
            });

        function updatePositions() {
            circles
                .attr('cx', (d) => getCoords(d).cx) 
                .attr('cy', (d) => getCoords(d).cy); 
        }

        updatePositions();
        map.on('move', updatePositions); 
        map.on('zoom', updatePositions); 
        map.on('resize', updatePositions); 
        map.on('moveend', updatePositions); 

        const timeSlider = document.getElementById('time-slider');
        const selectedTime = document.getElementById('selected-time');
        const anyTimeLabel = document.getElementById('any-time');

        // Note: formatTime was moved to the top of your file, so we deleted the duplicate here!

        function updateTimeDisplay() {
            let timeFilter = Number(timeSlider.value); 

            if (timeFilter === -1) {
                selectedTime.textContent = ''; 
                anyTimeLabel.style.display = 'block'; 
            } else {
                selectedTime.textContent = formatTime(timeFilter); 
                anyTimeLabel.style.display = 'none'; 
            }

            updateScatterPlot(timeFilter);
        }

        timeSlider.addEventListener('input', updateTimeDisplay);
        updateTimeDisplay();

        // Note: minutesSinceMidnight and filterTripsbyTime were deleted from here!

        function updateScatterPlot(timeFilter) {
            // Get the filtered stations using our efficient bucketing function
            const filteredStations = computeStationTraffic(stations, timeFilter);

            // Scale the circles dynamically 
            timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

            // Redraw the circles
            circles
                .data(filteredStations, (d) => d.short_name)
                .join('circle') 
                .attr('r', (d) => radiusScale(d.totalTraffic))
                .style('--departure-ratio', (d) => stationFlow(d.totalTraffic === 0 ? 0.5 : d.departures / d.totalTraffic))                
                .each(function (d) {
                    d3.select(this).select('title')
                      .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
                });
        }

    } catch (error) {
        console.error('Error loading JSON:', error); 
    }
});





