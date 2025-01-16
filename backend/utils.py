from math import radians, sin, cos, sqrt, atan2
import numpy as np

def calculate_haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great circle distance between two points on Earth using Haversine formula.
    
    Args:
        lat1 (float): Latitude of first point in degrees
        lon1 (float): Longitude of first point in degrees
        lat2 (float): Latitude of second point in degrees
        lon2 (float): Longitude of second point in degrees
        
    Returns:
        float: Distance between points in kilometers
    """
    R = 6371  # Earth's radius in kilometers
    
    lat1, lon1 = radians(lat1), radians(lon1)
    lat2, lon2 = radians(lat2), radians(lon2)
    
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    
    return R * c

def meters_to_latlon(x: float, y: float, center_lat: float, center_lon: float) -> tuple[float, float]:
    """
    Convert x,y coordinates in meters to latitude/longitude.
    
    Args:
        x (float): X coordinate in meters
        y (float): Y coordinate in meters
        center_lat (float): Reference latitude
        center_lon (float): Reference longitude
        
    Returns:
        tuple[float, float]: (latitude, longitude)
    """
    delta_lon = x / (111000 * np.cos(np.deg2rad(center_lat)))
    delta_lat = y / 111000
    
    return center_lat + delta_lat, center_lon + delta_lon 