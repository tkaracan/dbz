import json
import os
from datetime import datetime
from typing import Dict, Optional, Tuple
import numpy as np

class RadarCache:
    def __init__(self, cache_dir: str = "cache"):
        """Initialize the cache directory and index."""
        self.cache_dir = cache_dir
        self.data_dir = os.path.join(cache_dir, "radar_data")
        self.index_file = os.path.join(cache_dir, "cache_index.json")
        
        # Create cache directories if they don't exist
        os.makedirs(self.data_dir, exist_ok=True)
        
        # Load or create cache index
        self.cache_index = self._load_cache_index()

    def _load_cache_index(self) -> Dict:
        """Load the cache index from disk or create if not exists."""
        if os.path.exists(self.index_file):
            try:
                with open(self.index_file, 'r') as f:
                    return json.load(f)
            except json.JSONDecodeError:
                print("Warning: Cache index corrupted, creating new one")
                return {}
        return {}

    def _save_cache_index(self):
        """Save the cache index to disk."""
        with open(self.index_file, 'w') as f:
            json.dump(self.cache_index, f, indent=2)

    def get_cache_key(self, station_id: str, date_str: str, time_str: str) -> str:
        """Generate a unique cache key for a radar dataset."""
        return f"{station_id}_{date_str}_{time_str}"

    def get_cached_data(self, station_id: str, date_str: str, time_str: str) -> Optional[Tuple[np.ndarray, np.ndarray, np.ndarray]]:
        """
        Retrieve cached radar data if it exists.
        
        Args:
            station_id: Radar station identifier
            date_str: Date string in YYYYMMDD format
            time_str: Time string in HHMM format
            
        Returns:
            Optional[Tuple]: (ref, rng, az) arrays if cached, None if not found
        """
        cache_key = self.get_cache_key(station_id, date_str, time_str)
        
        if cache_key not in self.cache_index:
            return None
            
        cache_file = os.path.join(self.data_dir, f"{cache_key}.npz")
        
        if not os.path.exists(cache_file):
            # Clean up index if file is missing
            del self.cache_index[cache_key]
            self._save_cache_index()
            return None
            
        try:
            data = np.load(cache_file)
            return (data['ref'], data['rng'], data['az'])
        except Exception as e:
            print(f"Error loading cached data: {str(e)}")
            return None

    def cache_radar_data(self, station_id: str, date_str: str, time_str: str, 
                        radar_data: Tuple[np.ndarray, np.ndarray, np.ndarray]):
        """
        Cache radar data to disk.
        
        Args:
            station_id: Radar station identifier
            date_str: Date string in YYYYMMDD format
            time_str: Time string in HHMM format
            radar_data: Tuple of (ref, rng, az) arrays to cache
        """
        cache_key = self.get_cache_key(station_id, date_str, time_str)
        cache_file = os.path.join(self.data_dir, f"{cache_key}.npz")
        
        try:
            ref, rng, az = radar_data
            np.savez(cache_file, ref=ref, rng=rng, az=az)
            
            # Update index
            self.cache_index[cache_key] = {
                'station_id': station_id,
                'date': date_str,
                'time': time_str,
                'cached_at': datetime.utcnow().isoformat()
            }
            self._save_cache_index()
            
        except Exception as e:
            print(f"Error caching radar data: {str(e)}") 