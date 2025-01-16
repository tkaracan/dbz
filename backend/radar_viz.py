from siphon.radarserver import RadarServer
from datetime import datetime
import numpy as np
import requests
from scipy.interpolate import griddata
from typing import List, Dict, Tuple, Optional, Union, Any
import numpy.ma as ma
from utils import calculate_haversine_distance, meters_to_latlon
from radar_cache import RadarCache

# Initialize cache at module level
radar_cache = RadarCache()

def raw_to_masked_float(var: Any, data: np.ndarray) -> np.ndarray:
    """
    Convert raw radar data to masked float values.
    
    Args:
        var: Variable metadata containing scale and offset information
        data (np.ndarray): Raw radar data array
        
    Returns:
        np.ndarray: Masked array with converted float values
    """
    # Check for unsigned flag in a more robust way
    is_unsigned = False
    if hasattr(var, '_Unsigned'):
        is_unsigned = var._Unsigned
    elif hasattr(var, 'unsigned'):
        is_unsigned = var.unsigned
    elif hasattr(var, 'attributes') and '_Unsigned' in var.attributes:
        is_unsigned = var.attributes['_Unsigned']

    # Convert unsigned data if necessary
    if is_unsigned:
        data = data & 255

    # Mask missing points
    data = np.ma.array(data, mask=data == 0)

    # Get scale factor and offset, with defaults if not present
    scale_factor = getattr(var, 'scale_factor', 1.0)
    add_offset = getattr(var, 'add_offset', 0.0)

    # Convert to float using the scale and offset
    return data * scale_factor + add_offset


def get_radars_within_distance(center_lat: float, center_lon: float, max_distance_km: float = 230) -> List[Dict]:
    """
    Find all radar stations within specified distance from a center point.
    """
    url = "https://api.weather.gov/radar/stations"
    
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        
        nearby_stations = []
        
        # Calculate distances to all stations
        for station in data['features']:
            station_coords = station['geometry']['coordinates']
            station_lon = station_coords[0]
            station_lat = station_coords[1]
            
            distance = calculate_haversine_distance(center_lat, center_lon, station_lat, station_lon)
            
            if distance <= max_distance_km:
                nearby_stations.append({
                    'id': station['properties']['id'],
                    'distance': distance,
                    'lat': station_lat,
                    'lon': station_lon
                })
            
        print(f"Found {len(nearby_stations)} radar stations within {max_distance_km}km")
        return nearby_stations
        
    except Exception as e:
        print(f"Error fetching radar stations: {str(e)}")
        raise


def get_radar_data(station_id: str) -> Optional[Tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Fetch radar data for a specific station."""
    try:
        # First get the timestamp of the latest dataset
        timestamp = get_radar_timestamp(station_id)
        if not timestamp:
            return None
            
        date_str, time_str = timestamp
        
        # Check cache first
        cached_data = radar_cache.get_cached_data(station_id, date_str, time_str)
        if cached_data is not None:
            print(f"Using cached data for {station_id} from {date_str} {time_str}")
            return cached_data
            
        # If not in cache, fetch from server
        print(f"Fetching new data for {station_id} from {date_str} {time_str}")
        rs = RadarServer('https://thredds.ucar.edu/thredds/radarServer/nexrad/level2/IDD/')
        query = rs.query()
        query.stations(station_id).time(datetime.utcnow())
        rs.validate_query(query)
        catalog = rs.get_catalog(query)
        
        if not catalog.datasets:
            return None
            
        data = catalog.datasets[0].remote_access()
        
        # Extract radar data
        sweep = 0
        ref_var = data.variables['Reflectivity_HI']
        ref_data = ref_var[sweep]
        rng = data.variables['distanceR_HI'][:]
        az = data.variables['azimuthR_HI'][sweep]
        ref = raw_to_masked_float(ref_var, ref_data)
        
        # Cache the new data
        radar_cache.cache_radar_data(station_id, date_str, time_str, (ref, rng, az))
        
        return ref, rng, az

    except Exception as e:
        print(f"Error getting radar data: {str(e)}")
        return None


def merge_radar_data(radar_data_list: List[Tuple[np.ndarray, np.ndarray, np.ndarray]], 
                    center_lat: float, 
                    center_lon: float,
                    station_positions: List[Dict]) -> List[Dict]:
    """
    Merge radar data from multiple stations into a single grid.
    """
    grid_size = 1000
    max_range = 230000  # 230 km in meters
    max_reliable_range = 80000  # 80 km in meters (≈50 miles)
    
    # Create grid coordinates in meters
    x = np.linspace(-max_range, max_range, grid_size)
    y = np.linspace(-max_range, max_range, grid_size)
    X, Y = np.meshgrid(x, y)
    
    # Initialize merged grid with masked values
    merged_grid = np.ma.masked_all((grid_size, grid_size))
    
    # Check if we have any valid radar data
    if not radar_data_list or len(radar_data_list) != len(station_positions):
        print("No valid radar data to merge or mismatched station positions")
        return []
    
    # Process each radar's data
    for (radar_data, station) in zip(radar_data_list, station_positions):
        if radar_data is None:
            continue
            
        ref, rng, az = radar_data
        
        # Calculate station offset from center in meters
        station_lat, station_lon = station['lat'], station['lon']
        station_y = calculate_haversine_distance(center_lat, center_lon, station_lat, center_lon) * 1000
        station_x = calculate_haversine_distance(center_lat, center_lon, center_lat, station_lon) * 1000
        
        if station_lat < center_lat:
            station_y = -station_y
        if station_lon < center_lon:
            station_x = -station_x
            
        # Create meshgrid of range and azimuth
        rng_2d, az_2d = np.meshgrid(rng, az)
        
        # Convert from polar to cartesian coordinates (relative to radar station)
        x_radar = rng_2d * np.sin(np.deg2rad(az_2d)) + station_x
        y_radar = rng_2d * np.cos(np.deg2rad(az_2d)) + station_y
        
        # Calculate distance from center for each point
        distance_from_center = np.sqrt((X - station_x)**2 + (Y - station_y)**2)
        
        # Mask points beyond reliable radar range from the station
        range_mask = distance_from_center > max_reliable_range
        
        # Flatten arrays for interpolation
        x_flat = x_radar.flatten()
        y_flat = y_radar.flatten()
        ref_flat = ref.flatten()
        
        # Remove masked points
        valid = ~np.ma.getmask(ref_flat) if np.ma.is_masked(ref_flat) else np.ones_like(ref_flat, dtype=bool)
        x_valid = x_flat[valid]
        y_valid = y_flat[valid]
        ref_valid = ref_flat[valid]
        
        if len(x_valid) == 0:
            print(f"No valid points in radar data for station at {station_lat}, {station_lon}")
            continue
        
        try:
            # Create points array for interpolation
            points = np.column_stack((x_valid, y_valid))
            
            # Interpolate
            grid_z = griddata(points, ref_valid, (X, Y), method='linear')
            
            # Convert to masked array and mask invalid values
            grid_z = np.ma.masked_invalid(grid_z)
            
            # Apply range mask
            grid_z = np.ma.masked_where(range_mask, grid_z)
            
            # Update merged grid
            if merged_grid.mask.all():  # If grid is completely masked
                merged_grid = grid_z
            else:
                # Combine grids, taking maximum value where they overlap
                merged_grid = np.ma.where(
                    merged_grid.mask & ~grid_z.mask,
                    grid_z,
                    np.ma.where(
                        ~merged_grid.mask & ~grid_z.mask,
                        np.maximum(merged_grid, grid_z),
                        merged_grid
                    )
                )
                
        except Exception as e:
            print(f"Error processing radar data for station at {station_lat}, {station_lon}: {str(e)}")
            continue

    # Convert merged grid points to lon/lat
    points_data = []
    try:
        for i in range(grid_size):
            for j in range(grid_size):
                if not merged_grid.mask[i, j]:
                    # Get the raw dBZ value before normalization
                    dbz_value = float(merged_grid[i, j])
                    
                    # Skip points with dBZ < 5
                    if dbz_value < 5:
                        continue
                    
                    # Calculate distance from center for this point
                    point_distance = np.sqrt(X[i,j]**2 + Y[i,j]**2)
                    
                    # Skip points beyond reliable range (50 miles ≈ 80km)
                    if point_distance > max_reliable_range:
                        continue
                    
                    # Convert from meters to longitude/latitude
                    lat, lon = meters_to_latlon(X[i, j], Y[i, j], center_lat, center_lon)
                    
                    # Normalize reflectivity values
                    normalized_value = max(0, min(50, (dbz_value + 30) * (50/100)))
                    
                    point = {
                        'position': [float(lon), float(lat)],
                        'value': normalized_value
                    }
                    points_data.append(point)
    except Exception as e:
        print(f"Error converting grid to points: {str(e)}")
        return []
    
    print(f"Generated {len(points_data)} merged radar points (filtered dBZ < 5)")
    if points_data:
        print("Sample reflectivity range:", 
              min(p['value'] for p in points_data),
              "to",
              max(p['value'] for p in points_data))
    
    return points_data


def generate_plot_from_center(center_lat: float, 
                            center_lon: float, 
                            max_distance_km: float = 230) -> Dict:
    """Generate radar visualization data centered on specified coordinates."""
    print(f"Processing center coordinates: lat={center_lat}, lon={center_lon}")
    
    # Get nearby radar stations
    stations = get_radars_within_distance(center_lat, center_lon, max_distance_km)
    print(f"Found stations: {stations}")
    
    # Check timestamps and store them
    station_timestamps = {}
    print("\nChecking radar timestamps:")
    for station in stations:
        timestamp = get_radar_timestamp(station['id'])
        if timestamp:
            date_str, time_str = timestamp
            station_timestamps[station['id']] = f"{time_str[:2]}:{time_str[2:]} UTC"
            year = date_str[:4]
            month = date_str[4:6]
            day = date_str[6:8]
            print(f"Station {station['id']}: {year}-{month}-{day} {time_str[:2]}:{time_str[2:]} UTC")
    print()  # Empty line for readability
    
    radar_data_list = []
    station_info = []
    
    for station in stations:
        try:
            radar_data = get_radar_data(station['id'])
            if radar_data is not None:
                radar_data_list.append(radar_data)
                station_info.append({
                    **station,
                    'timestamp': station_timestamps.get(station['id'], 'N/A')
                })
                print(f"Added station {station['id']} to visualization")
        except Exception as e:
            print(f"Error getting data for station {station['id']}: {str(e)}")
            continue
    
    # Merge radar data and get points in lon/lat format
    points_data = merge_radar_data(radar_data_list, center_lat, center_lon, station_info)
    
    result = {
        'points': points_data,
        'center': [center_lon, center_lat],
        'stations': [{
            'id': station['id'],
            'position': [station['lon'], station['lat']],
            'distance': station['distance'],
            'range_km': max_distance_km,
            'timestamp': station['timestamp']  # Include timestamp in station info
        } for station in station_info]
    }
    
    print("Returning data:", {
        'num_points': len(points_data),
        'num_stations': len(station_info),
        'center': result['center']
    })
    
    return result


def get_radar_timestamp(station_id: str) -> Optional[tuple[str, str]]:
    """
    Get the date and timestamp from the most recent dataset for a radar station.
    
    Args:
        station_id (str): Radar station ID (e.g., 'KDAX')
        
    Returns:
        Optional[tuple[str, str]]: Tuple of (date in YYYYMMDD, time in HHMM) if found, None otherwise
    """
    try:
        rs = RadarServer('https://thredds.ucar.edu/thredds/radarServer/nexrad/level2/IDD/')
        query = rs.query()
        query.stations(station_id).time(datetime.utcnow())
        rs.validate_query(query)
        catalog = rs.get_catalog(query)
        
        if not catalog.datasets:
            print(f"No datasets found for station {station_id}")
            return None
            
        # Get the first (most recent) dataset name
        dataset_name = str(catalog.datasets[0])
        # Example format: Level2_KDAX_20240220_0559.ar2v
        
        try:
            parts = dataset_name.split('_')
            date_str = parts[-2]  # "20240220"
            time_str = parts[-1][:4]  # "0559"
            
            # Format date for readability
            year = date_str[:4]
            month = date_str[4:6]
            day = date_str[6:8]
            
            formatted_date = f"{year}-{month}-{day}"
            formatted_time = f"{time_str[:2]}:{time_str[2:]}"
            
            print(f"Station {station_id} latest scan: {formatted_date} {formatted_time} UTC")
            return (date_str, time_str)
            
        except (IndexError, AttributeError) as e:
            print(f"Error parsing timestamp from dataset name: {dataset_name}")
            return None
            
    except Exception as e:
        print(f"Error getting timestamp for station {station_id}: {str(e)}")
        return None 