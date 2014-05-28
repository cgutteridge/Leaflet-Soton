#!/bin/bash
rm -f hampshire-latest.osm.pbf
wget http://download.geofabrik.de/europe/great-britain/england/hampshire-latest.osm.pbf && osm2pgsql -s -S osm2pgsql.style -d hampshire hampshire-latest.osm.pbf
