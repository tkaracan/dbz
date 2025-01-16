# Weather Radar Visualization

A real-time weather radar visualization tool that displays NEXRAD radar data on an interactive map. This application allows users to view and analyze dBZ data from multiple radar stations across the United States.

## Features

- Real-time radar data visualization from NEXRAD Level II stations
- Multi-station data integration
- Customizable display settings:
  - Point size adjustment
  - Intensity control
  - Threshold settings
  - Opacity adjustment
- Interactive radar station range visualization
- Detailed dBZ statistics
- Adjustable radar range to display scan area coverage
- Automatic data caching for improved performance. Cache is stored in a local file. There is no deleting of old data since we may need it for future analysis.

## Prerequisites

- Python 3.8+
- A Mapbox account and API token

## Project Structure 
├── backend/

│ ├── main.py # FastAPI server

│ ├── radar_viz.py # Radar visualization logic

│ ├── radar_cache.py # Caching implementation

│ ├── utils.py # Utility functions

│ └── requirements.txt # Python dependencies

├── frontend/

│ ├── index.html # Main HTML file

│ ├── css/

│ │ └── styles.css # Styling

│ └── js/

│ └── radar.js # Frontend logic

├── .env # Environment variables

├── .env.example # Example environment file

└── README.md # Documentation


## Installation

1. Clone the repository and navigate to the project directory
2. Create and activate a virtual environment:
bash
python -m venv venv
source venv/bin/activate # On Windows: venv\Scripts\activate


3. Install required Python packages:
bash
pip install -r requirements.txt

4. Create a `.env` file in the root directory:
MAPBOX_TOKEN=your_mapbox_token_here

## Running the Application

1. Start the FastAPI server:
bash
python backend/main.py
2. Open your browser and navigate to:
http://localhost:8000/


## Usage

1. The map will load centered on san jose 
2. Click the "Scan" button to fetch radar data for your current view
3. Adjust display settings in the left panel:
   - Use sliders to modify visualization parameters
   - Select active radar stations to display coverage of radar stations that are used to generate the data
   - Radar range is set to max (230 km) reliable data creation distance, showing coverage of the radar stations can be helpful to understand the data reliability
4. View detailed statistics in the "Scan Area Statistics" section. You can also change min/max dBZ values to see specific range on the map
5. Hover over data points to see detailed dBZ values

## Dependencies

### Backend
- FastAPI
- uvicorn
- python-dotenv
- numpy
- scipy
- siphon
- requests

### Frontend
- deck.gl
- Mapbox GL JS

## Technical Details

### Cache Management
The application implements a caching system for radar data:
- Cache location: `cache/` directory
- Cache index: `cache/cache_index.json`
- Cached radar data: `cache/radar_data/`

### Configuration
The application can be configured through environment variables:
- `MAPBOX_TOKEN`: Your Mapbox API token (required)

