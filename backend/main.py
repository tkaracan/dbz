from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import os
import radar_viz
import uvicorn
from pydantic import BaseModel
from pathlib import Path

# Load environment variables
load_dotenv()

# Get Mapbox token from environment
MAPBOX_TOKEN = os.getenv('MAPBOX_TOKEN')
if not MAPBOX_TOKEN:
    raise ValueError("MAPBOX_TOKEN environment variable is not set")

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Define the request model
class Coordinates(BaseModel):
    center_lat: float
    center_lon: float

@app.get("/config")
async def get_config():
    """Return configuration including Mapbox token."""
    return {
        "mapboxToken": MAPBOX_TOKEN
    }

@app.post("/generate-radar")
async def generate_radar(coords: Coordinates):
    try:
        print(f"Received coordinates: {coords}")
        
        # Switch from single radar to multiple radars
        radar_data = radar_viz.generate_plot_from_center(
            coords.center_lat,
            coords.center_lon,
            max_distance_km=230  # Use radars within 230km
        )
        
        # Restructure the response to match what frontend expects
        return {
            "status": "success",
            "image": {
                "points": radar_data['points'],
                "center": radar_data['center'],
                "stations": radar_data['stations']  # Include stations data
            }
        }
        
    except Exception as e:
        import traceback
        print(f"Error generating radar data: {str(e)}")
        print(traceback.format_exc())
        return {"status": "error", "message": str(e)}

# Get the absolute path to the frontend directory
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

# Mount the frontend directories with correct absolute paths
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
app.mount("/css", StaticFiles(directory=str(FRONTEND_DIR / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(FRONTEND_DIR / "js")), name="js")

@app.route('/favicon.ico')
def favicon():
    return '', 204  # Return "No Content" status instead of 404

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)