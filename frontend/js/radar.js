// Constants
const INITIAL_VIEW_STATE = {
    longitude: -121.8863,  // San Jose
    latitude: 37.3382,
    zoom: 9,
    maxZoom: 16,
    pitch: 45,
    bearing: 0
};

const MAP_STYLE = 'mapbox://styles/mapbox/dark-v10';

const DBZ_COLORS = {
    5: [128, 128, 128],   // Light gray for < 5 dBZ
    10: [0, 100, 0],      // Dark green
    15: [0, 255, 0],      // Green
    20: [255, 255, 0],    // Yellow
    30: [255, 165, 0],    // Orange
    40: [255, 0, 0],      // Red
    45: [255, 192, 203],  // Pink
    50: [255, 0, 255],    // Magenta
    max: [128, 0, 128]    // Purple for > 50 dBZ
};

class RadarVisualization {
    constructor({
        container = 'map',
        mapboxToken,
        initialViewState = INITIAL_VIEW_STATE,
        mapStyle = MAP_STYLE
    } = {}) {
        this.container = container;
        this.mapboxToken = mapboxToken;
        this.initialViewState = initialViewState;
        this.mapStyle = mapStyle;
        
        this.deckgl = null;
        this.layers = [];
        this.currentViewState = null;
        this.lastReceivedData = null;
        this.settings = {
            radiusPixels: 25,
            intensity: 0.8,
            threshold: 0.5,
            opacity: 0.8,
            showRadarInfo: true,
            radarRange: 230,
            enabledRadars: new Set(),
            scanRadius: 80467,  // 50 miles in meters
            minDbz: 5,          // Default minimum dBZ
            maxDbz: 75          // Default maximum dBZ
        };
        this.targetLayer = null;
        this.tooltip = document.getElementById('tooltip');
        this.filteredData = null;  // Add this to cache filtered data
    }

    createLayers(data = null) {
        const layers = [];

        // Always show the target circle first
        const targetCircle = new deck.PolygonLayer({
            id: 'target-circle',
            data: [{
                center: [this.currentViewState.longitude, this.currentViewState.latitude],
                radius: this.settings.scanRadius  // Pass the radius in meters
            }],
            getPolygon: d => this.generateCirclePoints(d.center, d.radius),
            getFillColor: [255, 255, 255, 20],
            getLineColor: [255, 255, 255, 150],
            getLineWidth: 2,
            lineWidthUnits: 'pixels',
            stroked: true,
            filled: true,
            pickable: false
        });
        
        layers.push(targetCircle);

        // Add radar data layers if we have data
        if (data?.image?.points) {
            // Filter stations based on enabled state
            const enabledStations = data.image.stations.filter(
                station => this.settings.enabledRadars.has(station.id)
            );

            // Add heatmap and other radar layers
            layers.push(
                new deck.HeatmapLayer({
                    id: 'heatmap-layer',
                    data: data.image.points,
                    getPosition: d => d.position,
                    getWeight: d => {
                        const dbz = (d.value * 100/50) - 30;
                        return Math.max(0, dbz + 30);
                    },
                    radiusPixels: this.settings.radiusPixels,
                    intensity: this.settings.intensity,
                    threshold: this.settings.threshold,
                    aggregation: 'SUM',
                    colorRange: [
                        DBZ_COLORS[5], DBZ_COLORS[10], DBZ_COLORS[15],
                        DBZ_COLORS[20], DBZ_COLORS[30], DBZ_COLORS[40],
                        DBZ_COLORS[45], DBZ_COLORS[50], DBZ_COLORS.max
                    ],
                    opacity: this.settings.opacity,
                    pickable: true,
                    onHover: info => this.onDataHover(info)
                }),
                
                // Add invisible scatter layer for data picking
                new deck.ScatterplotLayer({
                    id: 'picker-layer',
                    data: data.image.points,
                    getPosition: d => d.position,
                    getRadius: 50,
                    opacity: 0,
                    pickable: true,
                    onHover: info => this.onDataHover(info),
                    radiusUnits: 'pixels'
                })
            );

            // Add radar station layers if enabled
            if (enabledStations.length > 0 && this.settings.showRadarInfo) {
                // Update station range based on settings
                const stationsWithRange = enabledStations.map(station => ({
                    ...station,
                    range_km: this.settings.radarRange
                }));

                // Add range circles
                layers.push(
                    new deck.PolygonLayer({
                        id: 'radar-ranges',
                        data: stationsWithRange,
                        getPolygon: d => this.generateCirclePoints(d.position, d.range_km),
                        getFillColor: [255, 255, 255, 0],  // Transparent fill
                        getLineColor: [255, 0, 0, 200],    // Red with high opacity
                        getLineWidth: 4,                    // Thicker lines
                        lineWidthUnits: 'pixels',
                        stroked: true,
                        filled: false,
                        pickable: false
                    })
                );

                // Add radar station labels
                layers.push(
                    new deck.TextLayer({
                        id: 'radar-labels',
                        data: stationsWithRange,
                        getPosition: d => d.position,
                        getText: d => d.id,
                        getSize: 18,                    // Slightly larger
                        getColor: [255, 255, 255],      // White text
                        getBackgroundColor: [0, 0, 0],  // Black background
                        backgroundPadding: [8, 6],      // More padding
                        fontFamily: 'Monaco, monospace',
                        getPixelOffset: [0, -10],       // Move text up by 10 pixels
                        getAlignmentBaseline: 'center', // Vertical alignment
                        getTextAnchor: 'middle',        // Horizontal alignment
                        billboard: true,                // Always face camera
                        pickable: true,
                        onHover: info => this.onStationHover(info)
                    })
                );
            }
        }

        return layers;
    }

    // Helper method to generate circle points
    generateCirclePoints(center, radiusKm) {
        const points = [];
        const numPoints = 64;  // Number of points to approximate circle
        
        // For the scan circle, we need to handle the radius differently
        // If it's our scan radius (in meters), convert to km first
        const radiusToUse = radiusKm > 1000 ? radiusKm / 1000 : radiusKm;
        
        for (let i = 0; i <= numPoints; i++) {
            const angle = (i / numPoints) * 2 * Math.PI;
            // Convert km to degrees (approximate)
            const radiusDeg = radiusToUse / 111;  // roughly 111km per degree
            const lat = center[1] + radiusDeg * Math.sin(angle);
            const lon = center[0] + radiusDeg * Math.cos(angle) / Math.cos(center[1] * Math.PI / 180);
            points.push([lon, lat]);
        }
        
        return points;
    }

    // Handler for radar station hover
    onStationHover(info) {
        const tooltip = this.tooltip;
        
        if (info.object) {
            tooltip.style.display = 'block';
            tooltip.style.left = `${info.x + 410}px`;  // 400px + 10px offset
            tooltip.style.top = `${info.y + 10}px`;
            tooltip.innerHTML = `
                <div>Station: ${info.object.id}</div>
                <div>Distance: ${info.object.distance.toFixed(1)} km</div>
            `;
        } else {
            tooltip.style.display = 'none';
        }
    }

    onDataHover(info) {
        const tooltip = this.tooltip;
        
        if (info.object) {
            // Convert normalized value back to dBZ
            const dbz = (info.object.value * 100/50) - 30;
            
            // Position the tooltip - add control panel width to x position
            tooltip.style.display = 'block';
            tooltip.style.left = `${info.x + 410}px`;  // 400px + 10px offset
            tooltip.style.top = `${info.y + 10}px`;
            
            // Format the content
            tooltip.innerHTML = `
                <div>DBZ: ${dbz.toFixed(1)}</div>
                <div>Lat: ${info.object.position[1].toFixed(4)}</div>
                <div>Lon: ${info.object.position[0].toFixed(4)}</div>
            `;
        } else {
            tooltip.style.display = 'none';
        }
    }

    async initialize() {
        try {
            console.log('Starting RadarVisualization initialization...');
            console.log('Token status:', {
                instanceToken: !!this.mapboxToken,
                windowToken: !!window.MAPBOX_TOKEN,
                mapboxGlToken: !!mapboxgl.accessToken
            });

            mapboxgl.accessToken = this.mapboxToken;
            this.currentViewState = this.initialViewState;
            
            console.log('Creating DeckGL instance...');
            this.deckgl = new deck.DeckGL({
                container: this.container,
                mapStyle: this.mapStyle,
                mapboxApiAccessToken: this.mapboxToken,
                initialViewState: this.initialViewState,
                controller: true,
                layers: this.createLayers(),
                onViewStateChange: this._handleViewStateChange.bind(this)
            });
            console.log('DeckGL instance created successfully');

            this.setupEventListeners();
            console.log('Event listeners set up');
        } catch (error) {
            console.error('Initialization error:', error);
            console.error('Error details:', {
                errorName: error.name,
                errorMessage: error.message,
                errorStack: error.stack
            });
            throw error;
        }
    }

    // New method to handle view state changes
    _handleViewStateChange({viewState}) {
        this.currentViewState = viewState;
        
        // Only update the target circle layer, preserve other layers
        if (this.lastReceivedData) {
            // Keep existing layers but update target circle
            const nonTargetLayers = this.layers.filter(layer => layer.id !== 'target-circle');
            const targetCircle = this.createLayers().find(layer => layer.id === 'target-circle');
            this.layers = [targetCircle, ...nonTargetLayers];
        } else {
            this.layers = this.createLayers();
        }
        this.deckgl.setProps({layers: this.layers});
    }

    setupEventListeners() {
        // Show radar button
        document.getElementById('show-radar').addEventListener('click', () => this.generateRadar());
        
        // Settings change listeners
        const inputs = ['radius-pixels', 'intensity', 'threshold', 'opacity', 'radar-range'];
        inputs.forEach(id => {
            const input = document.getElementById(id);
            const display = input.parentElement.querySelector('.value-display');
            
            if (!input) return;

            // Update value display when slider moves
            input.addEventListener('input', (e) => {
                display.textContent = e.target.value;
                this.updateSettings();
            });
        });

        // Add accordion functionality
        document.querySelectorAll('.accordion-header').forEach(header => {
            // Open the Display Settings by default
            if (header === document.querySelector('.accordion-header')) {
                header.classList.add('active');
                header.nextElementSibling.style.display = 'block';
            }

            header.addEventListener('click', () => {
                const content = header.nextElementSibling;
                const isActive = header.classList.contains('active');
                
                // Toggle clicked item
                header.classList.toggle('active');
                content.style.display = isActive ? 'none' : 'block';
            });
        });
    }

    updateSettings() {
        this.settings = {
            radiusPixels: Number(document.getElementById('radius-pixels').value),
            intensity: Number(document.getElementById('intensity').value),
            threshold: Number(document.getElementById('threshold').value),
            opacity: Number(document.getElementById('opacity').value),
            radarRange: Number(document.getElementById('radar-range').value),
            showRadarInfo: true,
            enabledRadars: this.settings.enabledRadars,
            scanRadius: this.settings.scanRadius,
            minDbz: this.settings.minDbz,
            maxDbz: this.settings.maxDbz
        };
        
        this.updateLayers();
    }

    async generateRadar() {
        const loadingPopup = document.getElementById('loading-popup');
        
        try {
            loadingPopup.style.display = 'flex';
            
            const response = await fetch('/generate-radar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    center_lat: this.currentViewState.latitude,
                    center_lon: this.currentViewState.longitude
                })
            });

            const data = await response.json();
            this.lastReceivedData = data;
            
            // Update layers and statistics
            this.updateLayers();  // This will now also update statistics
            
            // Update radar station list
            this.updateRadarStationList(data.image.stations);

        } catch (error) {
            console.error('Error:', error);
            alert('Failed to load radar data: ' + error.message);
        } finally {
            loadingPopup.style.display = 'none';
        }
    }

    updateLayers() {
        if (this.lastReceivedData) {
            // Filter points based on dBZ range
            const filteredPoints = this.lastReceivedData.image.points.filter(point => {
                const dbz = (point.value * 100/50) - 30;
                return dbz >= this.settings.minDbz && dbz <= this.settings.maxDbz;
            });

            const filteredData = {
                ...this.lastReceivedData,
                image: {
                    ...this.lastReceivedData.image,
                    points: filteredPoints
                }
            };

            this.layers = this.createLayers(filteredData);
            this.deckgl.setProps({layers: this.layers});
            
            // Add this line to update statistics after updating layers
            this.updateStatistics();
        } else {
            // If no radar data, just create the target circle
            this.layers = this.createLayers();
            this.deckgl.setProps({layers: this.layers});
        }
    }

    updateRadarStationList(stations) {
        const container = document.getElementById('radar-station-list');
        container.innerHTML = '';
        this.settings.enabledRadars.clear();
        
        stations.forEach(station => {
            const div = document.createElement('div');
            div.className = 'radar-station-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `radar-${station.id}`;
            checkbox.checked = false;  // Start disabled
            
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.settings.enabledRadars.add(station.id);
                } else {
                    this.settings.enabledRadars.delete(station.id);
                }
                this.updateLayers();
            });
            
            const label = document.createElement('label');
            label.htmlFor = `radar-${station.id}`;
            label.textContent = `${station.id} (${station.distance.toFixed(1)} km - ${station.timestamp})`;
            
            div.appendChild(checkbox);
            div.appendChild(label);
            container.appendChild(div);
        });

        // Show and open the Radar Stations accordion
        const radarAccordion = document.querySelector('.accordion-item:nth-child(2)');
        const header = radarAccordion.querySelector('.accordion-header');
        const content = radarAccordion.querySelector('.accordion-content');
        
        // Make sure the accordion item itself is visible
        radarAccordion.style.display = 'block';
        
        // Open the accordion
        header.classList.add('active');
        content.style.display = 'block';
    }

    // Add this method to calculate dBZ statistics
    calculateDbzStats(points) {
        if (!points || !Array.isArray(points)) {
            console.error('Invalid points data:', points);
            return {
                veryLight: { range: '5-10 dBZ', count: 0, color: '#CCCCCC', id: 'veryLight' },
                light: { range: '10-20 dBZ', count: 0, color: '#808080', id: 'light' },
                lightMod: { range: '20-30 dBZ', count: 0, color: '#90EE90', id: 'lightMod' },  // Light green
                moderate: { range: '30-35 dBZ', count: 0, color: '#FFA500', id: 'moderate' },
                modStrong: { range: '35-40 dBZ', count: 0, color: '#FF8C00', id: 'modStrong' }, // Dark orange
                strong: { range: '40-45 dBZ', count: 0, color: '#FF0000', id: 'strong' },
                veryStrong: { range: '45-50 dBZ', count: 0, color: '#FF1493', id: 'veryStrong' }, // Deep pink
                extreme: { range: '50+ dBZ', count: 0, color: '#800080', id: 'extreme' }
            };
        }

        const stats = {
            veryLight: { range: '5-10 dBZ', count: 0, color: '#CCCCCC', id: 'veryLight' },
            light: { range: '10-20 dBZ', count: 0, color: '#808080', id: 'light' },
            lightMod: { range: '20-30 dBZ', count: 0, color: '#90EE90', id: 'lightMod' },
            moderate: { range: '30-35 dBZ', count: 0, color: '#FFA500', id: 'moderate' },
            modStrong: { range: '35-40 dBZ', count: 0, color: '#FF8C00', id: 'modStrong' },
            strong: { range: '40-45 dBZ', count: 0, color: '#FF0000', id: 'strong' },
            veryStrong: { range: '45-50 dBZ', count: 0, color: '#FF1493', id: 'veryStrong' },
            extreme: { range: '50+ dBZ', count: 0, color: '#800080', id: 'extreme' }
        };

        // Get center coordinates
        const centerLat = this.currentViewState.latitude;
        const centerLon = this.currentViewState.longitude;

        points.forEach(point => {
            const lat = point.position[1];
            const lon = point.position[0];
            const distance = this.calculateDistance(centerLat, centerLon, lat, lon);

            if (distance <= this.settings.scanRadius) {
                const dbz = (point.value * 100/50) - 30;  // Convert normalized value back to dBZ
                if (dbz >= 50) stats.extreme.count++;
                else if (dbz >= 45) stats.veryStrong.count++;
                else if (dbz >= 40) stats.strong.count++;
                else if (dbz >= 35) stats.modStrong.count++;
                else if (dbz >= 30) stats.moderate.count++;
                else if (dbz >= 20) stats.lightMod.count++;
                else if (dbz >= 10) stats.light.count++;
                else if (dbz >= 5) stats.veryLight.count++;
            }
        });

        return stats;
    }

    // Helper method to calculate distance between two points in meters
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth's radius in meters
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c; // Distance in meters
    }

    // New method to handle statistics updates separately
    updateStatistics() {
        if (!this.lastReceivedData?.image?.points) {
            const statsContainer = document.getElementById('dbz-stats');
            statsContainer.innerHTML = '<div class="stat-row">No data available</div>';
            return;
        }

        const statsContainer = document.getElementById('dbz-stats');
        statsContainer.innerHTML = '';
        
        // Create min dBZ dropdown
        const minDbzDiv = document.createElement('div');
        minDbzDiv.className = 'stat-row';
        minDbzDiv.innerHTML = `
            <label class="stat-label">Minimum dBZ:</label>
            <select id="min-dbz" class="dbz-select">
                ${this.generateDbzOptions(5, 75, 5, this.settings.minDbz)}
            </select>
        `;

        // Create max dBZ dropdown
        const maxDbzDiv = document.createElement('div');
        maxDbzDiv.className = 'stat-row';
        maxDbzDiv.innerHTML = `
            <label class="stat-label">Maximum dBZ:</label>
            <select id="max-dbz" class="dbz-select">
                ${this.generateDbzOptions(5, 75, 5, this.settings.maxDbz)}
            </select>
        `;

        // Add dropdowns to container
        statsContainer.appendChild(minDbzDiv);
        statsContainer.appendChild(maxDbzDiv);

        // Add event listeners
        const minDbzSelect = document.getElementById('min-dbz');
        const maxDbzSelect = document.getElementById('max-dbz');

        minDbzSelect.addEventListener('change', (e) => {
            this.settings.minDbz = Number(e.target.value);
            if (this.settings.maxDbz < this.settings.minDbz) {
                this.settings.maxDbz = this.settings.minDbz;
                maxDbzSelect.value = this.settings.maxDbz;
            }
            this.updateLayers();
        });

        maxDbzSelect.addEventListener('change', (e) => {
            this.settings.maxDbz = Number(e.target.value);
            if (this.settings.minDbz > this.settings.maxDbz) {
                this.settings.minDbz = this.settings.maxDbz;
                minDbzSelect.value = this.settings.minDbz;
            }
            this.updateLayers();
        });

        // Add statistics display with detailed counts
        if (this.lastReceivedData.image.points.length > 0) {
            const dbzInfo = this.getDbzRange();
            const statsDiv = document.createElement('div');
            statsDiv.className = 'stat-row stats-summary';
            
            let statsHtml = `<div class="stats-text">Total echoes: ${this.lastReceivedData.image.points.length}
Range: ${dbzInfo.range} dBZ

Echo counts by range:
${Object.entries(dbzInfo.rangeCounts)
    .map(([range, count]) => `${range} dBZ: ${count} echoes`)
    .join('\n')}</div>`;
            
            statsDiv.innerHTML = statsHtml;
            statsContainer.appendChild(statsDiv);
        }
    }

    // Helper method to generate dropdown options
    generateDbzOptions(min, max, step, selected) {
        let options = '';
        for (let value = min; value <= max; value += step) {
            options += `<option value="${value}" ${value === selected ? 'selected' : ''}>${value}</option>`;
        }
        return options;
    }

    // Helper method to get current dBZ range in the data
    getDbzRange() {
        if (!this.lastReceivedData?.image?.points.length) return 'N/A';
        
        const values = this.lastReceivedData.image.points.map(p => (p.value * 100/50) - 30);
        const min = Math.min(...values).toFixed(1);
        const max = Math.max(...values).toFixed(1);
        
        // Calculate echo counts by range
        const rangeCounts = {};
        for (let i = 5; i < 75; i += 5) {
            const rangeMin = i;
            const rangeMax = i + 5;
            const count = values.filter(v => v >= rangeMin && v < rangeMax).length;
            if (count > 0) {  // Only include ranges with echoes
                rangeCounts[`${rangeMin}-${rangeMax}`] = count;
            }
        }
        
        return {
            range: `${min} to ${max}`,
            rangeCounts: rangeCounts
        };
    }
}

// Remove the DOMContentLoaded wrapper and execute immediately
(async function() {
    try {
        console.log('radar.js initialization starting...');
        console.log('Current MAPBOX_TOKEN status:', {
            windowToken: !!window.MAPBOX_TOKEN,
            mapboxGlToken: !!mapboxgl.accessToken,
            tokenLength: window.MAPBOX_TOKEN?.length
        });

        const radar = new RadarVisualization({
            mapboxToken: window.MAPBOX_TOKEN
        });
        
        console.log('RadarVisualization instance created, initializing...');
        await radar.initialize();
        console.log('RadarVisualization initialized successfully');
    } catch (error) {
        console.error('Failed to initialize radar:', error);
    }
})();  // Immediately invoke the async function