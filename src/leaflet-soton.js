(function() {
    "use strict";

    var LS = window.LS = L.extend({}, L.Mixin.Events, {

        dataPath: 'data.json',
        imagePath: 'images/',

        data: null,
        _dataFetchInProgress: false,

        workstationData: null,
        updateWorkstationData: true, // regularly poll for workstation data
        workstationDataUpdateTime: 30000, // time to wait between requests
        useLocalStorage: true,
        localStorageTimeout: 172800, // two days in milliseconds
        _workstationDataFetchInProgress: false,
        _workstationDataFetchTimeout: null,

        getData: function(callback) {
            if (this.data !== null) {
                callback(this.data);
            } else {
                this.on("dataload", callback);

                if (LS.useLocalStorage &&
                    'localStorage' in window && window['localStorage'] !== null) {

                    if ("data" in localStorage) {
                        var refetchTime = parseInt(localStorage.dataTimestamp, 10) + LS.localStorageTimeout;

                        if (refetchTime > new Date().getTime()) {
                            LS.data = JSON.parse(localStorage.data);

                            LS.fire("dataload", LS.data);

                            return;

                        }

                        // refresh the data, as its too old
                    }

                    // data not in local storage, so fetch it
                }

                if (!this._dataFetchInProgress) {
                    this._dataFetchInProgress = true;
                    getJSON({url: LS.dataPath, cache: false} , function(data, stringData) {
                        LS._dataFetchInProgress = false;

                        if (data === null) {
                            setTimeout(function() {
                                LS.getData(callback);
                            }, 5000);
                            return;
                        }

                        LS.data = data;

                        if (LS.useLocalStorage &&
                            'localStorage' in window && window['localStorage'] !== null) {
                            localStorage.data = stringData;
                            localStorage.dataTimestamp = new Date().getTime();
                        }

                        LS.fire("dataload", data);
                    });
                }
            }
        },
        getWorkstationData: function(callback) {
            if (this.workstationData !== null) {
                callback(this.workstationData);
            } else {
                this.addOneTimeEventListener("workstationData", callback);

                if (this._workstationDataFetchTimeout !== null || // if a fetch is going to happen
                    this._workstationDataFetchInProgress) { // or a fetch is in progress
                    // data will be fetched, so return
                    return;
                }

                this._updateWorkstationData();
            }
        },
        getRoomFor: function(uri) {
            var parts = LS.data.buildingParts.features;

            for (var i=0; i<parts.length; i++) {
                var part = parts[i];

                if (part.properties.buildingpart !== "room")
                    continue;

                var contents = part.properties.contents;

                if (contents) {
                    for (var j=0; j<contents.length; j++) {
                        var content = contents[j];

                        if (content.feature === uri) {
                            return part;
                        }
                    }
                }

                var features = part.properties.features;

                if (features) {
                    for (var j=0; j<features.length; j++) {
                        var feature = features[j];

                        if (feature.feature === uri) {
                            return part;
                        }
                    }
                }
            }

            return null;

        },
        getFeatureByURI: function(uri) {
            var features, feature;

            var names = Object.keys(LS.data);

            for (var i=0; i<names.length; i++) {
                features = LS.data[names[i]].features;

                for (var j=0; j<features.length; j++) {
                    feature = features[j];

                    if ("uri" in feature.properties &&
                        feature.properties.uri === uri) {
                        return feature;
                    }
                }
            }

            return null;
        },
        getVendingMachinesLayer: function() {
            var features = this.data.vendingMachines.features;

            var layer = new L.GeoJSON(features, {
                pointToLayer: vendingPointToLayer,
                onEachFeature: function(feature, layer) {
                    layer.on('click', function(e) {

                        // If this is a leaflet-soton map
                        if ("showInfo" in this._map) {
                          var popupOptions = {
                              offset: icons.vendingHotDrinks.options.popupAnchor
                          };

                          var content = vendingPopupTemplate(feature.properties);

                          this._map.showInfo(content, e.latlng, popupOptions);
                        }
                    });
                }
            });

            return layer;
        },
        getPointOfServiceLayer: function() {
            var features = this.data.pointsOfService.features;

            var pointFeatures = features.map(function(feature) {
                var pointFeature = {
                    type: "Feature",
                    geometry: {
                        type: "Point"
                    },
                    properties: feature.properties
                };

                console.log(feature.properties);
                var c = feature.properties.center;
                c = [c[1], c[0]];
                pointFeature.geometry.coordinates = c;

                return pointFeature;
            });

            var layer = new L.GeoJSON(pointFeatures, {
                pointToLayer: function(feature, latlng) {
                    var icon;

                    icon = icons.vendingHotDrinks;

                    return L.marker(latlng, {icon: icon});
                },
                onEachFeature: function(feature, layer) {
                    layer.on('click', function(e) {

                        // If this is a leaflet-soton map
                        if ("showInfo" in this._map) {
                            var popupOptions = {
                                offset: icons.vendingHotDrinks.options.popupAnchor
                            };

                            var content = pointOfServiceTemplate(feature.properties);

                            this._map.showInfo(content, e.latlng, popupOptions);
                        }
                    });
                }
            });

            return layer;
        },
        _updateWorkstationData: function() {
            this._workstationDataFetchInProgress = true;

            var query;

            if (this.data.workstations.features.length > 10) {
                query = 'PREFIX soton: <http://id.southampton.ac.uk/ns/>\
SELECT * WHERE {\
    ?uri soton:workstationSeats ?total_seats .\
    ?uri soton:workstationFreeSeats ?free_seats .\
    ?uri soton:workstationStatus ?status .\
    FILTER (\
        ?free_seats >= 0\
    )\
}';
            } else {
                query = 'PREFIX soton: <http://id.southampton.ac.uk/ns/>\
SELECT * WHERE {\
    ?uri soton:workstationSeats ?total_seats .\
    ?uri soton:workstationFreeSeats ?free_seats .\
    ?uri soton:workstationStatus ?status .\
    FILTER (';

                query += '(' + workstations.features.map(function(workstation) {
                    return '?uri = <' + workstation.properties.uri + '> ';
                }).join(' || ');

                query +=  ') && ?free_seats >= 0';

                query += ')}';
            }

            getJSON({
                    url: 'http://sparql.data.southampton.ac.uk/?query=' + encodeURIComponent(query)
                },
                function(data) {
                    LS._workstationDataFetchInProgress = false;

                    // If fetching data has failed
                    if (data === null) {
                        // Only report this if there is no existing data
                        if (LS.workstationData === null) {
                            LS.fire("workstationData", null);
                        }

                        return;
                    }

                    LS.workstationData = {};

                    data.results.bindings.forEach(function(result) {
                        var workstation = result.uri.value;
                        var id = "#" + workstation.split('/').slice(-1)[0];
                        var obj = {};

                        obj.total_seats = parseInt(result.total_seats.value, 10);
                        obj.free_seats = parseInt(result.free_seats.value, 10);
                        obj.status = result.status.value;

                        LS.workstationData[workstation] = obj;
                    });

                    LS.fire("workstationData", LS.workstationData);
                }
            );
        }
    });

    if (LS.updateWorkstationData) {
        LS.on("workstationData", function(data) {
            LS._workstationDataFetchTimeout = setTimeout(function() {
                LS._workstationDataFetchTimeout = null;
                LS._updateWorkstationData();
            }, LS.workstationDataUpdateTime);
        });
    }

    var busRouteColours = {};

    var icons = {
        created: false,
        createIcons: function() {
            this.busStop = L.icon({
                iconUrl: LS.imagePath + 'busstop.png',

                iconSize:     [32, 37], // size of the icon
                iconAnchor:   [16, 37], // point of the icon which will correspond to marker's location
                popupAnchor:  [0, -35]  // point from which the popup should open relative to the iconAnchor
            });

            this.printer = L.icon({
                iconUrl: LS.imagePath + 'printer.png',

                iconSize:     [32, 37], // size of the icon
                iconAnchor:   [16, 37], // point of the icon which will correspond to marker's location
                popupAnchor:  [0, -35]  // point from which the popup should open relative to the iconAnchor
            });

            this.vendingHotDrinks = L.icon({
                iconUrl: LS.imagePath + 'coffee.png',

                iconSize:     [32, 37],
                iconAnchor:   [16, 37],
                popupAnchor:  [0, -35]
            });

            this.vendingSweets = L.icon({
                iconUrl: LS.imagePath + 'candy.png',

                iconSize:     [32, 37],
                iconAnchor:   [16, 37],
                popupAnchor:  [0, -35]
            });

            this.toiletsUnisex = L.icon({
                iconUrl: LS.imagePath + 'toilets.png',

                iconSize:     [32, 32],
                iconAnchor:   [16, 16],
                popupAnchor:  [0, -35]
            });

            this.toiletsMale = L.icon({
                iconUrl: LS.imagePath + 'toilets-m.png',

                iconSize:     [32, 32],
                iconAnchor:   [16, 16],
                popupAnchor:  [0, -35]
            });

            this.toiletsFemale = L.icon({
                iconUrl: LS.imagePath + 'toilets-f.png',

                iconSize:     [32, 32],
                iconAnchor:   [16, 16],
                popupAnchor:  [0, -35]
            });

            this.toiletsDisabled = L.icon({
                iconUrl: LS.imagePath + 'toilets_disability.png',

                iconSize:     [32, 32],
                iconAnchor:   [16, 37],
                popupAnchor:  [0, -35]
            });

            this.theBridge = L.icon({
                iconUrl: LS.imagePath + 'logos/the-bridge.png',

                iconSize:     [300, 80],
                iconAnchor:   [150, 40],
                popupAnchor:  [0, 0]
            });

            this.theStags = L.icon({
                iconUrl: LS.imagePath + 'logos/stags-head.png',

                iconSize:     [300, 80],
                iconAnchor:   [150, 40],
                popupAnchor:  [0, 0]
            });

            this.theSUSUShop = L.icon({
                iconUrl: LS.imagePath + 'logos/susu-shop.png',

                iconSize:     [300, 80],
                iconAnchor:   [150, 40],
                popupAnchor:  [0, 0]
            });

            this.theSUSUCafe = L.icon({
                iconUrl: LS.imagePath + 'logos/susu-cafe.png',

                iconSize:     [300, 80],
                iconAnchor:   [150, 40],
                popupAnchor:  [0, 0]
            });

            this.created = true;
        }
    };

    var blankStyle = function(feature) {
        return {
            weight: 0,
            opacity: 0,
            fillOpacity: 0
        };
    };

    var showStyle = function(feature) {
        return {
            weight: 1,
            opacity: 1,
            fillOpacity: 1
        };
    };

    function featureHasPopup( feature )
    {
        if (feature.properties.buildingpart === "corridor") {
            return; // No popup for corridors yet
        }

        if (feature.properties.buildingspart === "room" &&
            !("uri" in feature.properties)) {

            return false;
        }

        return true;
    }

    var emptyFeatureCollection = { type: "FeatureCollection", features: [] };
    var transparaentStyle = function(feature) {return {weight: 0, opacity: 0, fillOpacity: 0};};

    var layerNames = [
        'sites',
       // 'parking',
        'bicycleParking',
        'buildings'];

    var busRouteStyle = function(feature) {
        return {weight: 5, opacity: 0.5, color: feature.properties.colour};
    };

    LS.Map = L.Map.extend({
        options: {
            center: [50.9354, -1.3964],
            indoor: false,
            busRoutes: false,
            busRouteControl: false,
            workstations: false,
            zoom: 17,
            detectRetina: true,
            tileUrl: 'http://bus.southampton.ac.uk/graphics/map/tiles/{z}/{x}/{y}.png',
            tileAttribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors',
            levelControlPosition: 'bottomright'
        },

        initialize: function (id, options) {
            options = L.setOptions(this, options);

            L.Map.prototype.initialize.call(this, id, options);
            var map = this;

            if (!("layers" in options) || options.layers.length === 0) {
                var tileLayer = L.tileLayer(options.tileUrl, {
                    maxZoom: 22,
                    attribution: options.tileAttribution
                });

                tileLayer.addTo(map);
            }

            if (!("MarkerClusterGroup" in L)) {
                options.workstations = false;
            }

            if (!("highlight" in options)) {
                options.highlight = {};
            }

            if ("Hash" in L) {
                var hash;
                if (this.options.indoor) {
                    hash = new LS.Hash(this);
                } else {
                    hash = new L.Hash(this);
                }
            }

            if (!icons.created) {
                icons.createIcons();
            }

            var layers = {};
            var showingIndoorControl = false;
            var showLevel = null;
            map._startLevel = options.level || "1";

            layerNames.forEach(function(layerName) {
                var layerOptions = {
                    style: function(feature) {
                        if (feature.properties.uri in options.highlight &&
                            options.highlight[feature.properties.uri]) {

                            return {weight: 5, opacity: 0.5, color: 'blue'};
                        } else {
                            return blankStyle();
                        }
                    }
                };

                if (layerName === 'buildings') {
                    layerOptions.onEachFeature = function(feature, layer) {
                        // When the feature is clicked on
                        layer.on('click', function(e) {
                            var content = buildingTemplate(feature.properties,
                                                           options,
                                                           map,
                                                           function() { map.closeInfo(); });

                            map.showInfo(content, e.latlng);
                        });
                    };
                } else {
                    layerOptions.onEachFeature = function(feature, layer) {
                        // When the feature is clicked on
                        layer.on('click', function(e) {
                            var content = popupTemplates[layerName](feature.properties);

                            map.showInfo(content, e.latlng);
                        });
                    };
                }

                if (layerName === "bicycleParking") {
                    layerOptions.pointToLayer = function (feature, latlng) {
                        return L.circleMarker(latlng, {
                            radius: 8,
                            opacity: 1,
                        });
                    };
                }

                layers[layerName] = L.geoJson(emptyFeatureCollection, layerOptions).addTo(map);
            });

            this.on('zoomend', function(e) {
                var zoom = this.getZoom();

                // The buildingParts layer wants to show on zooms > 19, that is 20, 21 and 22
                // The sites layer wants to show on zoom levels less than 18, that is 17 - 1

                if (zoom <= 15) {
                    if (!(this.hasLayer(layers.sites))) {
                        this.addLayer(layers.sites, true);
                    }
                } else if (zoom > 15) {
                    if (this.hasLayer(layers.sites)) {
                        this.removeLayer(layers.sites);
                    }
                }
            });

            LS.getData(function(data) {
                for (var layerName in layers) {
                    var layer = layers[layerName];

                    layer.clearLayers();
                    layer.addData(data[layerName]);
                }

                if ("Route" in L) {
                    var routeLayer = map.routeLayer = new L.Route(options.busRoutes ? data.busRoutes : emptyFeatureCollection, data.busStops, {
                        routeOptions: {
                            onEachFeature: function(feature, layer) {
                                layer.on('click', function(e) {
                                    var content = busRouteTemplate(feature.properties);

                                    map.showInfo(content, e.latlng);
                                });
                            },
                            style: busRouteStyle
                        },
                        stopOptions: {
                            onEachFeature: function(feature, layer) {
                                layer.on('click', function(e) {
                                    var content = busStopTemplate(feature.properties);

                                    map.showInfo(content, e.latlng);
                                });
                            }
                        }
                    });
                    routeLayer.addTo(map);

                    if (options.busRoutes && options.busRouteControl) {
                        var routeControl = new L.Control.Route(routeLayer, "sidebar", {
                            routeMasterSort: function(a, b) {
                                var refs = {
                                    "U1": 1,
                                    "U2": 2,
                                    "U6": 6,
                                    "U9": 9,
                                    "U1N": 10
                                };

                                return refs[a] - refs[b];
                            },
                            position: "right"
                        });
                        routeControl.addTo(map);
                        routeControl.show();

                        var routeSidebarControl = new L.Control.ShowRouteSidebar(routeControl);
                        routeSidebarControl.addTo(map);
                    }
                }

                LS.getWorkstationData(function(workstationData) {

                    if (options.indoor) {
                        // Adding .features means leaflet will
                        // ignore those without a geometry
                        map.indoorLayer = L.indoor(data.buildingParts.features, {
                            level: map._startLevel,
                            style: function(feature) {
                                if (feature.geometry.type === "Point") {
                                    // Assume that this is a door

                                    return {
                                        stroke: false,
                                        fillColor: "#000000",
                                        fillOpacity: 1
                                    };
                                }

                                var fill = '#def5fc';
                                if (feature.properties.buildingpart === 'corridor') {
                                    fill = '#169EC6';
                                } else if (feature.properties.buildingpart === 'verticalpassage') {
                                    fill = '#0A485B';
                                }

                                return {
                                    fillColor: fill,
                                    weight: 1,
                                    color: '#666',
                                    fillOpacity: 1
                                };
                            },
                            markerForFeature: function(part) {
                                if (part.properties.buildingpart === "room") {

                                    var iconCoords = part.properties.center;

                                    if (part.properties.name === "The Bridge") {
                                        return L.marker(iconCoords, {icon: icons.theBridge});
                                    } else if (part.properties.name === "SUSU Shop") {
                                        return L.marker(iconCoords, {icon: icons.theSUSUShop});
                                    } else if (part.properties.name === "The Stag's") {
                                        return L.marker(iconCoords, {icon: icons.theStags});
                                    } else if (part.properties.name === "SUSU Cafe") {
                                        return L.marker(iconCoords, {icon: icons.theSUSUCafe});
                                    }

                                    var partWorkstation = null;

                                    if ('contents' in part.properties) {
                                        part.properties.contents.forEach(function(feature) {
                                            if (feature.subject === "http://id.southampton.ac.uk/point-of-interest-category/iSolutions-Workstations") {
                                                partWorkstation = feature;
                                            }
                                        });
                                    }

                                    if (part.properties.amenity === "toilets") {
                                        if ("male" in part.properties) {
                                            return L.marker(iconCoords, {icon: icons.toiletsMale});
                                        } else if ("female" in part.properties) {
                                            return L.marker(iconCoords, {icon: icons.toiletsFemale});
                                        } else if ("unisex" in part.properties) {
                                            return L.marker(iconCoords, {icon: icons.toiletsUnisex});
                                        } // TODO: Disabled
                                    }

                                    var content;

                                    if ("name" in part.properties && "ref" in part.properties) {
                                        content = part.properties.name + " (" + part.properties.ref + ")";
                                    } else if ("ref" in part.properties) {
                                        content = part.properties.ref;
                                    } else if ("name" in part.properties) {
                                        content = part.properties.name;
                                    } else {
                                        return;
                                    }

                                    if (partWorkstation) {
                                        if (partWorkstation.feature in workstationData) {
                                            var state = workstationData[partWorkstation.feature];

                                            var closed = (state.status.indexOf("closed") !== -1)

                                            var image;
                                            var workstationIcon;

                                            if (!closed) {
                                                image = 'workstation-group.png';
                                                workstationIcon = '<div class="ls-workstationicon" style="margin-left: auto; margin-right: auto; background-image: url(' + LS.imagePath + image + ')">';
                                            } else {
                                                image = 'workstation-closed.png';
                                                workstationIcon = '<div class="ls-workstationicon-small" style="margin-left: auto; margin-right: auto; background-image: url(' + LS.imagePath + image + ')">';
                                            }

                                            if (!closed) {
                                                workstationIcon += '<div style="padding-left: 26px;">';

                                                var freeSeats = state.free_seats;
                                                workstationIcon += freeSeats + "</div>";
                                            }

                                            workstationIcon += '</div>';

                                            content = workstationIcon + content;
                                        } else {
                                            var workstationIcon = '<div style="margin-left: auto; margin-right: auto; width: 32px; height: 32px; background-image: url(' + LS.imagePath + 'workstation.png' + ')"></div>';

                                            content = workstationIcon + content;
                                        }
                                    }

                                    var myIcon = L.divIcon({
                                        className: 'ls-room-marker',
                                        html: content,
                                        iconSize: new L.Point(100, 14),
                                        iconAnchor: new L.Point(50, 7)
                                    });

                                    var marker = L.marker(iconCoords, {
                                        icon: myIcon
                                    });

                                    return marker;
                                }
                            },
                            onEachFeature: function(feature, layer) {
                                if (!featureHasPopup(feature)) {
                                    return;
                                }

                                layer.on('click', function(e) {
                                    map.showFeaturePopup(feature, e.latlng, options);
                                });
                            },
                            pointToLayer: function (feature, latlng) {
                                if ('vending' in feature.properties) {
                                    return vendingPointToLayer(feature, latlng);
                                } else if ('uri' in feature.properties && feature.properties.uri.indexOf("http://id.southampton.ac.uk/mfd/") === 0) {
                                    return L.marker(latlng, {icon: icons.printer});
                                } else {
                                    return L.circleMarker(latlng, {
                                        radius: 4,
                                        clickable: false
                                    });
                                }
                            }
                        });

                        map.indoorLayer.addData(data.vendingMachines);
                        map.indoorLayer.addData(data.multiFunctionDevices);

                        map.levelControl = L.Control.level({
                            levels: map.indoorLayer.getLevels(),
                            level: map._startLevel,
                            position: options.levelControlPosition
                        });

                        map.levelControl.addEventListener("levelchange", map.indoorLayer.setLevel, map.indoorLayer);

                        map.levelControl.on("levelchange", function(e) {
                            map.fireEvent("levelchange", e);
                        });

                    }

                    var workstationMarkerLayer;
                    if (options.workstations) {
                        workstationMarkerLayer = LS.workstationLayer();

                        LS.on("workstationData", function(data) {
                            if (map.hasLayer(workstationMarkerLayer)) {
                                map.removeLayer(workstationMarkerLayer);
                                workstationMarkerLayer = LS.workstationLayer();
                                map.addLayer(workstationMarkerLayer);
                            } else {
                                workstationMarkerLayer = LS.workstationLayer();
                            }
                        });
                    }

                    if (options.indoor) {
                        var level = 19;
                        if (L.Browser.retina) {
                            level = 18;
                        }

                        var setIndoorContent = function(zoom) {
                            if (zoom <= level) {
                                if (showingIndoorControl) {
                                    map.levelControl.removeFrom(map);
                                    showingIndoorControl = false;
                                }

                                if (map.hasLayer(map.indoorLayer)) {
                                    map.removeLayer(map.indoorLayer);
                                }

                                if (options.workstations && !map.hasLayer(workstationMarkerLayer)) {
                                    map.addLayer(workstationMarkerLayer);
                                }
                            } else if (zoom > level) {
                                if (!showingIndoorControl) {
                                    map.levelControl.addTo(map);
                                    showingIndoorControl = true;
                                }

                                if (!map.hasLayer(map.indoorLayer)) {
                                    map.addLayer(map.indoorLayer);
                                }

                                if (options.workstations && map.hasLayer(workstationMarkerLayer)) {
                                    map.removeLayer(workstationMarkerLayer);
                                }
                            }
                        };

                        map.on('zoomend', function(e) {
                            setIndoorContent(this.getZoom());
                        });

                        setIndoorContent(map.getZoom());
                    } else {
                        if (options.workstations) {
                            map.addLayer(workstationMarkerLayer);
                        }
                    }
                });
            });

            return this;
        },
        setLevel: function(level) {
            if ("levelControl" in this) {
                this.levelControl.setLevel(level);
            } else {
                this._startLevel = level;
            }
        },
        getLevel: function() {
            if ("levelControl" in this) {
                return this.levelControl.getLevel();
            } else {
                return this._startLevel;
            }
        },
        show: function(thing) {
            this.showByURI(thing);
        },
        showPopupByURI: function(uri) {
            var map = this;

            var buildings = LS.data.buildings.features;
            for (var i=0; i<buildings.length; i++) {
                var building = buildings[i];

                if (building.properties.uri === uri) {
                    var content = buildingTemplate(building.properties,
                                               this.options,
                                               map,
                                               function() { map.closeInfo(); });

                    map.panTo(building.properties.center);

                    map.showInfo(content, building.properties.center);

                    return;
                }
            }
        },
        showByURI: function(uri) {
            var feature = LS.getFeatureByURI(uri);

            if (feature === null) {
                throw "can't find " + uri;
            }

            if (!("geometry" in feature)) {
                throw "no location for " + uri;
            }

            if (feature.geometry.type === "Polygon") {
                var coords = L.GeoJSON.coordsToLatLngs(feature.geometry.coordinates[0], 0, L.GeoJSON.coordsToLatLng);
                var bounds = L.latLngBounds(coords);
                this.fitBounds(bounds);

                if ("level" in feature.properties) {
                    if (L.Util.isArray(feature.properties.level)) {
                        this.setLevel(feature.properties.level[0]);
                    } else {
                        this.setLevel(feature.properties.level);
                    }
                }

                this.closePopup();

                return;
            } else if (feature.geometry.type === "Point") {
                this.setView(L.GeoJSON.coordsToLatLng(feature.geometry.coordinates), 20);

                if ("level" in feature.properties) {
                    if (L.Util.isArray(feature.properties.level)) {
                        this.setLevel(feature.properties.level[0]);
                    } else {
                        this.setLevel(feature.properties.level);
                    }
                } else {
                    // If this is a workstation
                    if (uri.indexOf("http://id.southampton.ac.uk/point-of-service/workstations") === 0) {
                        var room = LS.getRoomFor(uri);

                        if (room !== null) {
                            this.setLevel(room.properties.level);
                        }
                    }
                }

                this.closePopup();
                return;
            } else {
                throw "unable to handle " + feature.geometry.type;
            }
        },
        panByURI: function(uri, zoom, opts) {
            var feature = LS.getFeatureByURI(uri);

            if (feature === null) {
                throw "can't find " + uri;
            }

            if (!("geometry" in feature)) {
                throw "no location for " + uri;
            }

            var target_loc;
            if (feature.geometry.type === "Polygon") {
                if ("center" in feature.properties) {
                    target_loc = feature.properties.center;
                } else {
                    target_loc = feature.geometry.coordinates[0][0];
                    target_loc = [center[1], center[0]];
                }

                if ("level" in feature.properties) {
                    if (L.Util.isArray(feature.properties.level)) {
                        this.setLevel(feature.properties.level[0]);
                    } else {
                        this.setLevel(feature.properties.level);
                    }
                }
            } else if (feature.geometry.type === "Point") {
                target_loc = L.GeoJSON.coordsToLatLng(feature.geometry.coordinates);

                if ("level" in feature.properties) {
                    if (L.Util.isArray(feature.properties.level)) {
                        this.setLevel(feature.properties.level[0]);
                    } else {
                        this.setLevel(feature.properties.level);
                    }
                } else {
                    // If this is a workstation
                    if (uri.indexOf("http://id.southampton.ac.uk/point-of-service/workstations") === 0) {
                        var room = LS.getRoomFor(uri);

                        if (room !== null) {
                            this.setLevel(room.properties.level);
                        }
                    }
                }
            } else {
                throw "unable to handle " + feature.geometry.type;
            }

            this.closePopup();
            this.setView(target_loc, zoom, opts);
        },
        showInfo: function(content, latlng, options) {
            var map = this;
            options = options || {};

            options.maxWidth = map.getContainer().offsetWidth*0.7;
            options.minWidth = 320;

            if (options.minWidth > options.maxWidth) {
                options.minWidth = options.maxWidth;
            }

            options.maxHeight = map.getContainer().offsetHeight*0.6;

            map.closeInfo();

            var popup = L.popup(options).setLatLng(latlng);
            map._popup = popup;

            popup.setContent(content);

            popup.openOn(map);
        },
        closeInfo: function() {
            var map = this;

            if (map._popup) {
                map.closePopup(map._popup);
            }
        },
        showFeaturePopup: function(feature, latlng, options) {
            var map = this;
            var content;
            var popupOptions = {};

            // When the feature is clicked on
            if ("buildingpart" in feature.properties) {
                if (feature.properties.buildingpart === "room") {
                    content = roomPopupTemplate(feature.properties, options, map);
                } else if (feature.properties.buildingpart === "verticalpassage") {
                    content = verticalPassagePopupTemplate(feature.properties);
                }
            } else { // Assume that it is a printer
                // TODO: Use different icons where appropriate
                popupOptions.offset = icons.vendingHotDrinks.options.popupAnchor;

                if ('vending' in feature.properties) {
                    content = vendingPopupTemplate(feature.properties);
                } else {
                    content = printerPopupTemplate(feature.properties);
                }
            }
            map.showInfo(content, latlng, popupOptions);
        }
    });

    LS.map = function (id, options) {
        return new LS.Map(id, options);
    };

    function vendingPointToLayer(feature, latlng) {
        var icon;

        if (feature.properties.vending === 'drinks') {
            icon = icons.vendingHotDrinks;
        } else if (feature.properties.vending === 'sweets') {
            icon = icons.vendingSweets;
        } else {
            console.warn("Unrecognired vending " + feature.properties.vending);
        }

        return L.marker(latlng, {icon: icon});
    }

    // Template functions for creating the popups

    var popupTemplates = {
        sites: siteTemplate,
        buildings: buildingTemplate,
        bicycleParking: bicycleParkingTemplate
        //parking: parkingTemplate
    };

    function roomPopupTemplate(properties, options, map) {
        properties = L.extend({}, properties);

        if (!("name" in properties)) {
            properties.name = "Room ";
            if ("ref" in properties) {
                properties.name += properties.ref;
            }
        }

        return getTemplateWrapper(properties, function(content) {

            var image_dom = imageTemplate(properties, options, map, close);
            if( image_dom ) { content.appendChild( image_dom ); }

            return;

            if ('contents' in properties) {
                properties.contents.forEach(function(feature) {
                    createBlankLink(feature.feature, feature.label, tabs.contents);

                    if (feature.subject === "http://id.southampton.ac.uk/point-of-interest-category/iSolutions-Workstations") {
                        var content = '<a href="' + feature.feature + '">' + feature.label + '</a>';
                        var data = properties.data;
                        if (typeof data !== 'undefined' && 'total_seats' in data) {
                            content += '<br>' + data.status;
                            content += '<br>' + data.free_seats + ' seats free (' + data.total_seats + ' total seats)';
                        }
                        return content;
                    } else {
                        return '<a href="' + feature.feature + '">' + feature.label + '</a>';
                    }
                });
            }

            if ('features' in properties) {
                var featureList = document.createElement("ul");

                properties.features.forEach(function(feature) {
                    var featureLi = document.createElement("li");

                    createBlankLink(feature.feature, feature.label, featureLi);

                    featureList.appendChild(featureLi);
                });

                tabs.features.appendChild(featureList);
            }

            // TODO: Find a better way to match the rooms, also add the rooms
            // on level 5.
            var bookableLibraryRoomNames = ["1A", "1B", "1C", "2A", "2B", "2C",
                                            "2D", "3A", "3B", "3C", "3D", "3E",
                                            "3F"];
            if ('name' in properties &&
                bookableLibraryRoomNames.indexOf(properties.name) != -1) {

                createBlankLink("http://libcal.soton.ac.uk/booking/hartleyrooms",
                                "This room can be booked through the Library Room Booking system.",
                                tabs.bookings);
            }

        });
    }

    function verticalPassagePopupTemplate(properties) {
        properties = L.extend({}, properties);

        if (!("name" in properties)) {
            if (properties["buildingpart:verticalpassage"] === "stairway") {
                properties.name = "Stairway";
            } else if (properties["buildingpart:verticalpassage"] === "lift") {
                properties.name = "Lift";
            } else {
                properties.name = "Vertical Passage";
            }

            if ("ref" in properties) {
                properties.name += properties.ref;
            }
        }

        return getTemplateWrapper(properties, function(content) {

            if ("level" in properties) {
                content.appendChild(document.createTextNode("Levels:"));

                var levelList = document.createElement("ul");

                properties.level.forEach(function(level) {
                    var levelLi = document.createElement("li");
                    levelLi.textContent = level;

                    levelList.appendChild(levelLi);
                });

                content.appendChild(levelList);
            }
        });
    }

    function printerPopupTemplate(properties) {
        properties.name = "Printer";

        return getTemplateWrapper(properties, function(content) {

        });
    }

    function vendingPopupTemplate(properties) {
        properties.name = "Vending Machine";

        return getTemplateWrapper(properties, function(content) {

            content.textContent = properties.vending;

        });
    }

    function siteTemplate(properties) {
        return getTemplateWrapper(properties, function(content) {

        });
    }

    function imageTemplate(properties, options, map, close) {

        if (!("images" in properties))
            return false;

        if (properties.images.length === 0)
            return false;

        var imageWidth;
        var imageHeight;

        var versions = properties.images[0].versions;
        var url;

        var widthBound;
        var heightBound;
        if ("popupWidth" in options && "popupHeight" in options) {
            widthBound = options.popupWidth;
            heightBound = options.popupHeight;
        } else {
            var mapContainer = map.getContainer();
            widthBound = mapContainer.offsetWidth;
            heightBound = mapContainer.offsetHeight;

            widthBound *= 0.7;
            heightBound *= 0.7;
        }

        for (var i=0; i<versions.length; i++) {
            var version = versions[i];
            url = version.url;

            imageWidth = version.width;
            imageHeight = version.height;

            if (imageWidth < widthBound &&
                imageHeight < heightBound) {
                break; // Use this image, as it is the first smaller
                       // than the screen width
            }
        }

        var content = document.createElement( "div" );

        var image = document.createElement('img');
        image.setAttribute('src', url);
        image.setAttribute('width', imageWidth);
        image.setAttribute('height', imageHeight);
        image.style.margin = 'auto';
        image.style.display = 'block';
        content.appendChild(image);

        // Link to the biggest image (versions is sorted by size on the server)
        var imageLink = createBlankLink(versions[0].url, false, content);
        imageLink.style.textAlign = 'right';
        imageLink.style.display = 'block';
        imageLink.style.width = imageWidth+"px";
        imageLink.style.margin = 'auto';
        imageLink.textContent="View fullsize photo";

        //createBlankLink(properties.images[0].licence, "Licence", content);
        return content;
    }

    function addRoomsToFloors(rooms, floors) {
        for (var level in rooms) {
            var levelRooms = rooms[level];

            levelRooms.sort(function(a, b) {
                if (a > b) {
                    return 1;
                }
                return -1;
            });

            levelRooms.forEach(function(uri) {
                var room = LS.getFeatureByURI(uri);

                if (room === null) {
                    console.error("Unable to find room " + uri);
                    return;
                }

                var info = {
                    label: room.properties.ref,
                    uri: uri,
                    geo: ("center" in room.properties)
                };

                if ("name" in room.properties) {
                    info.label += ":  " + room.properties.name;
                }

                if(!(level in floors)) {
                    floors[level] = {};
                }

                floors[level][uri] = info;
            });
        }
    }

    function addVendingMachinesToFloors(vendingMachines, floors) {
        vendingMachines.forEach(function(machine) {
            var feature = LS.getFeatureByURI(machine);

            if (feature === null) {
                console.error("no feature for " + machine);
                return;
            }

            var info = {
                label: feature.properties.label,
                uri: feature.properties.uri,
                geo: ("geometry" in feature)
            };

            var level = "Unknown";

            if ("level" in feature.properties) {
                level = feature.properties.level;
            }

            if (!(level in floors)) {
                floors[level] = {};
            }

            floors[level][feature.properties.uri] = info;
        });
    }

    function addMFDsToFloors(mfds, floors) {
        mfds.forEach(function(machine) {
            var feature = LS.getFeatureByURI(machine);

            if (feature === null) {
                console.error("no feature for " + machine);
                return;
            }

            var info = {
                label: feature.properties.label,
                uri: feature.properties.uri,
                geo: ("geometry" in feature)
            };

            var level = "Unknown";

            if ("level" in feature.properties) {
                level = feature.properties.level;
            }

            if(!(level in floors)) {
                floors[level] = {};
            }

            floors[level][feature.properties.uri] = info;
        });
    }

    function renderThingSet(set, map, options, close) {
        var content_ids = Object.keys( set );
        var content = document.createElement( 'div' );
        content_ids.forEach(function(thing_id) {
            var info = set[thing_id];
            var div = document.createElement('div');

            if (info.geo) {
                var link = createLink('#', false, div);
                link.textContent = info.label

                link.onclick = function() {
                    var feature = LS.getFeatureByURI(info.uri);

                    close();

                    map.panByURI(info.uri, 20, {
                        animate: true
                    });

                    if (featureHasPopup(feature)) {
                        var latlng;

                        if (feature.geometry.type === "Polygon") {
                            latlng = feature.properties.center;
                        } else if (feature.geometry.type === "Point") {
                            latlng = L.GeoJSON.coordsToLatLng(feature.geometry.coordinates);
                        }

                        map.showFeaturePopup(feature, latlng, options);
                    }
                };
            } else {
                var span = document.createElement("span");
                span.textContent = info.label + "  ";

                div.appendChild(span);

                var link = document.createElement('a');
                link.setAttribute('href', info.uri);
                link.setAttribute('target', '_blank');
                link.className = 'ls-popup-uri';
                link.textContent = "(Full Information)";

                div.appendChild(link);
            }

            content.appendChild(div);
        });
        return content;
    }

    function buildingTemplate(properties, options, map, close) {
        var indoor = options.indoor;

        return getTemplateWrapper(properties, function(content) {

            var image_dom = imageTemplate(properties, options, map, close);

            if (image_dom) {
                content.appendChild(image_dom);
            }

            var floors = {};

            // Rooms
            if (indoor) {
                addRoomsToFloors(properties.rooms, floors);

                if ("services" in properties) {
                    var services = properties.services;

                    if ("vendingMachines" in services) {
                        addVendingMachinesToFloors(services.vendingMachines, floors);
                    }

                    if ("mfds" in services) {
                        addMFDsToFloors(services.mfds, floors);
                    }
                }
            }

            var floor_ids = Object.keys(floors);

            floor_ids.sort(function(a, b) {
              if (a === "Unknown") return 1;
              if (b === "Unknown") return -1;

              a = parseInt(a, 10);
              b = parseInt(b, 10);

              if (a < b) {
                return -1;
              }
              return 1;
            });

            floor_ids.forEach(function(floor_id) {
                var h4 = document.createElement( "h4" );
                content.appendChild( h4 );
                h4.textContent = "Floor "+floor_id;
                content.appendChild(renderThingSet(floors[floor_id], map, options, close) );
            });
        });
    }

    function pointOfServiceTemplate(properties) {
        return getTemplateWrapper(properties, function(content) {

            var description = document.createElement("div");
            if ("description" in properties) {
                description.innerHTML = properties.description;
            } else {
                description.textContent = "No Description Available";
            }
            content.appendChild(description);

            if ("offerings" in properties) {
                Object.keys(properties.offerings).forEach(function(sectionURI) {
                    var section = properties.offerings[sectionURI];

                    var header = document.createElement("h4");
                    header.textContent = section.label;

                    content.appendChild(header);

                    section.items.forEach(function(item) {
                        var a = document.createElement("a");

                        a.textContent = item.label;
                        a.href = item.uri;

                        content.appendChild(a);
                        content.appendChild(document.createElement("br"));
                    });
                });
            }
        });
    }

    function parkingTemplate(properties) {
        if (!('name' in properties))
            properties.name = 'Car Park';

        return getTemplateWrapper(properties, function(content) {
            var table = createPropertyTable(
                [
                    "Access",
                    "Spaces",
                    "Fee"
                ],
                [
                    properties.access,
                    properties.capacity,
                    properties.fee
                ]
            );

            content.appendChild(table);
        });
    }

    function bicycleParkingTemplate(properties) {
        if (!('name' in properties))
            properties.name = 'Bicycle Parking';

        return getTemplateWrapper(properties, function(content) {
            var table = createPropertyTable(
                [
                    "Capacity",
                    "Type",
                    "Covered"
                ],
                [
                    properties.capacity,
                    properties.bicycle_parking,
                    properties.covered
                ]
            );

            content.appendChild(table);
        });
    }

    function busStopTemplate(properties) {
        return getTemplateWrapper(properties, function(content) {

            var routeList = document.createElement("ul");

            properties.routes.forEach(function(route) {
                var routeLi = document.createElement("li");
                routeLi.textContent = route;

                routeList.appendChild(routeLi);
            });

            content.appendChild(routeList);

            var IFrame = document.createElement('iframe');
            IFrame.setAttribute('src', 'http://bus.southampton.ac.uk/bus-stop-iframe/' + properties.uri.slice(37)  + ".html")
            IFrame.setAttribute('frameBorder', '0');
            IFrame.setAttribute('style', 'width: 100%; height 100%;');

            content.appendChild(IFrame);

            console.log(properties);
        });
    }

    function busRouteTemplate(properties) {
        return getTemplateWrapper(properties, function(content) {

        /*
         * note
        */

        });
    }

    // Templating Utility Functions

    function capitaliseFirstLetter(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    function getEnergyGraph(properties) {

        return html;
    }

    function getTemplateWrapper(properties, contentFunction) {
        var documentFragment = document.createDocumentFragment();

        var title = document.createElement('h2');
        title.classList.add("ls-popup-title");
        documentFragment.appendChild(title);

        var titleText = "";

        if ('loc_ref' in properties) {
            var span = document.createElement( "span" );
            span.classList.add("ls-popup-title-ref");
            title.appendChild( span );
            span.textContent = properties.loc_ref;
            title.appendChild( document.createTextNode( " " ) );
        }

        if ('name' in properties) {
            var span = document.createElement( "span" );
            span.classList.add("ls-popup-title-name");
            span.textContent = properties.name;
            title.appendChild( span );
        }

        if ('uri' in properties) {
            var link = document.createElement('a');
            link.setAttribute('href', properties.uri);
            link.setAttribute('target', '_blank');
            link.className = 'ls-popup-uri';
            link.textContent = "(Full Information)";

            documentFragment.appendChild(link);
        }


        var div_inner = document.createElement("div");
        div_inner.classList.add("ls-popup-content");
        contentFunction(div_inner);
        documentFragment.appendChild( div_inner );

        return documentFragment;
    }

    var createTabs = function(tabs, container) {

        var nav = L.DomUtil.create('ul', 'ls-nav ls-nav-tabs', container);
        var content = L.DomUtil.create('div', 'tab-content', container);

        var tabDivs = {};

        var activeDiv;
        var activeLi;

        tabs.forEach(function(tab) {
            var li = L.DomUtil.create('li', '', nav);

            var a = L.DomUtil.create('a', '', li);

            a.setAttribute('href', '#');

            a.textContent = tab.name;

            // Content
            var div = L.DomUtil.create('div', 'tab-pane', content);

            if ('active' in tab && tab.active) {
                activeDiv = div;
                activeLi = li;

                li.classList.add('active');
                div.style.display = 'block';
            } else {
                div.style.display = 'none';
            }

            a.onclick = function() {
                activeDiv.style.display = 'none';
                activeLi.classList.remove('active');

                div.style.display = 'block';
                li.classList.add('active');

                activeDiv = div;
                activeLi = li;

                return false;
            };

            tabDivs[tab.id] = div;
        });

        return tabDivs;
    };

    var createLink = function(url, target, container) {
        var link = document.createElement('a');

        link.setAttribute('href', url);

        if (target)
            link.setAttribute('target', target);

        if (container)
            container.appendChild(link);

        return link;
    };

    var createBlankLink = function(url, text, container) {
        var link = createLink(url, '_blank', container);

        if (text)
            link.textContent = text;

        return link;
    };

    function createPropertyTable(keys, values) {
        var table = document.createElement('table');

        keys.forEach(function(key, i) {
            var tr = document.createElement('tr');

            var keyTd = document.createElement('td');
            keyTd.textContent = key;
            tr.appendChild(keyTd);

            var valueTd = document.createElement('td');
            valueTd.setAttribute('align', 'right');
            valueTd.textContent = values[i] || "Unknown";
            tr.appendChild(valueTd);

            table.appendChild(tr);
        });

        return table;
    }

    // General Utility Functions

    function getBusTimes(uri) {
        var parts = uri.split("/");
        var id = parts[parts.length - 1].split(".")[0];

        return "http://data.southampton.ac.uk/bus-stop/" + id + ".html?view=iframe";
    }

    function getJSON(options, callback) {
        var xhttp = new XMLHttpRequest();
        xhttp.ontimeout = function () {
            callback(null);
        };
        xhttp.timeout = 4000;

        options.data = options.data || null;

        var url = options.url

        if ("cache" in options && options.cache == false) {
            url += "?" + new Date().getTime();
        }

        xhttp.open('GET', url, true);
        xhttp.setRequestHeader('Accept', 'application/json');

        xhttp.send(options.data);
        xhttp.onreadystatechange = function() {
            if (xhttp.status == 200 && xhttp.readyState == 4) {
                callback(JSON.parse(xhttp.responseText), xhttp.responseText);
            }
        };
    }

    function smallScreen() {
        return window.innerWidth < 500;
    }

    // Custom Hash Support

    if ("Hash" in L) {
        LS.Hash = L.Class.extend(L.extend({}, L.Hash.prototype, {
            initialize: function (map, showLevel) {
                this.showLevel = showLevel;
                L.Hash.call(this, map);

                var hash = this;

                map.on("levelchange", function() {
                    hash.onMapMove();
                });
            },
            parseHash: function(hash) {
                var startOfSecondPart = hash.indexOf("/");
                var firstPart = hash.slice(0, startOfSecondPart);

                if (firstPart.indexOf('#') === 0) {
                    firstPart = firstPart.substr(1);
                }

                var newLevel = parseInt(firstPart, 10);
                if (!isNaN(newLevel) && newLevel !== this.map.getLevel()) {
                    this.map.setLevel(newLevel);
                }

                var secondPart = hash.slice(startOfSecondPart + 1);

                return L.Hash.prototype.parseHash.call(this, secondPart);
            },
            formatHash: function(map) {
                var hash = L.Hash.prototype.formatHash.call(this, map);

                var levelString = map.getLevel() + '';

                hash = "#" + levelString + '/' + hash.slice(1);

                return hash;
            }
        }));
    }

    var WorkstationIcon = L.DivIcon.extend({
        initialize: function(workstations, workstationData) {
            var html = '<div style="padding-left: 26px;">';

            var freeSeats = 0;

            var allClosed = true;
            var someStateKnown = false;

            var generalIcon = {
                iconUrl: LS.imagePath + "workstation.png",
                iconSize:     [32, 32],
                iconAnchor:   [16, 16],
                className: 'ls-workstationicon'
            }

            var openIconWithState = {
                iconUrl: LS.imagePath + "workstation-group.png",
                iconSize:     [66, 32],
                iconAnchor:   [33, 16],
                className: 'ls-workstationicon'
            }

            var closedIcon = {
                iconUrl: LS.imagePath + "workstation-closed.png",
                iconSize:     [32, 32],
                iconAnchor:   [16, 16],
                className: 'ls-workstationicon'
            }

            workstations.forEach(function(workstation) {
                if (workstation in workstationData) {
                    var state = workstationData[workstation];

                    var closed = (state.status.indexOf("closed") !== -1)
                    allClosed = allClosed && closed;

                    freeSeats += workstationData[workstation].free_seats;

                    someStateKnown = true;
                }
            });

            var iconUrl;

            if (someStateKnown) {
                if (allClosed) {
                    L.setOptions(this, closedIcon);
                } else {
                    html += freeSeats + "</div>";

                    openIconWithState.html = html;

                    L.setOptions(this, openIconWithState);
                }
            } else {
                L.setOptions(this, generalIcon);
            }
        },
        createIcon: function (oldIcon) {
            var div = L.DivIcon.prototype.createIcon.call(this, oldIcon);

            div.style.backgroundImage = "url(" + this.options.iconUrl + ")";

            return div;
        }
    });

    if ("MarkerClusterGroup" in L) {
        LS.WorkstationLayer = L.MarkerClusterGroup.extend({
            initialize: function() {
                var workstations = {};

                LS.data.workstations.features.forEach(function(feature) {
                    workstations[feature.properties.uri] = feature.properties;
                });

                var workstationLayer = this;

                var workstationsTemplate = function(workstationURIs) {
                    var div = document.createElement('div');

                    var headerText = "Workstation";
                    if (workstationURIs.length !== 1) {
                        headerText = "Workstations";
                    }

                    var header = document.createElement('h2');
                    header.textContent = headerText;
                    div.appendChild(header);

                    workstationURIs.forEach(function(uri) {
                        var workstation = workstations[uri];
                        var state = workstationData[uri];

                        var link = createLink("#", null, div);
                        link.textContent = workstation.label;

                        link.onclick = function() {
                            workstationLayer._map.showByURI(uri);
                        };

                        var text;
                        if (typeof state !== 'undefined') {
                            var closed = (state.status.indexOf("closed") !== -1)
                            if (!closed) {
                                text = document.createTextNode(" " + state.free_seats + " free seats (" + state.total_seats + " total seats) " + state.status);
                            } else {
                                text = document.createTextNode(" " + state.status);
                            }
                        } else {
                            text = document.createTextNode(" State Unknown");
                        }
                        div.appendChild(text);

                        var br = document.createElement("br");
                        div.appendChild(br);
                    });

                    return div;
                };

                var workstationData = {};

                L.MarkerClusterGroup.prototype.initialize.call(this, {
                    spiderfyOnMaxZoom: false,
                    showCoverageOnHover: false,
                    zoomToBoundsOnClick: false,
                    iconCreateFunction: function(cluster) {
                        var uris = cluster.getAllChildMarkers().map(function(marker) {
                            return marker.uri;
                        });

                        return new WorkstationIcon(uris, workstationData);
                    }
                });

                LS.getWorkstationData(function(data) {
                    workstationData = data;

                    LS.data.workstations.features.forEach(function(workstation) {
                        var icon = new WorkstationIcon([workstation.properties.uri], workstationData);

                        var marker = new L.Marker(L.GeoJSON.coordsToLatLng(workstation.geometry.coordinates), { icon: icon });

                        marker.uri = workstation.properties.uri;

                        workstationLayer.addLayer(marker);
                    });

                    workstationLayer.on('click', function (a) {
                        var uri = a.layer.uri;

                        var popupOptions = {offset: [0, -15]};
                        var content = workstationsTemplate([uri]);

                        this._map.showInfo(content, a.latlng, popupOptions);
                    }).on('clusterclick', function (a) {
                        var uris = a.layer.getAllChildMarkers().map(function(marker) {
                            return marker.uri;
                        });

                        var popupOptions = {offset: [0, -15]};

                        var content = workstationsTemplate(uris);

                        this._map.showInfo(content, a.latlng, popupOptions);
                    });
                });

                return this;
            }
        });

        LS.workstationLayer = function () {
            return new LS.WorkstationLayer();
        };
    }
})();

L.SelectiveVisibilityLayer = L.Class.extend({
    _layers: {},

    initialize: function(options) {
        L.setOptions(this, options);
    },
    onAdd: function (map) {
        this._map = map;

        if (this.options.level === null) {
            var levels = this.getLevels();

            if (levels.length !== 0) {
                this.options.level = levels[0];
            }
        }

        this._map.addLayer(this._layers[this.options.level]);
    },
    onRemove: function (map) {
        this._map = null;
    },
    addLayer: function(level, options) {
        var layers = this._layers;

        options = this.options;

        data.features.forEach(function (part) {
            var level = part.properties.level;
            var layer;

            if (typeof level === 'undefined')
                return;

            if (level in layers) {
                layer = layers[level];
            } else {
                layer = layers[level] = L.geoJson({ type: "FeatureCollection", features: [] }, options);
            }

            layer.addData(part);
        });
    }
});

L.SelectiveVisibilityLayer = function(data, options) {
    return new L.Indoor(data, options);
};
// forEach compatability
if (!Array.prototype.forEach) {
    Array.prototype.forEach = function (fn, scope) {
        'use strict';
        var i, len;
        for (i = 0, len = this.length; i < len; ++i) {
            if (i in this) {
                fn.call(scope, this[i], i, this);
            }
        }
    };
}

// map function compatability
if (!Array.prototype.map) {
  Array.prototype.map = function(callback, thisArg) {

    var T, A, k;

    if (this === null) {
      throw new TypeError(" this is null or not defined");
    }

    // 1. Let O be the result of calling ToObject passing the |this| value as the argument.
    var O = Object(this);

    // 2. Let lenValue be the result of calling the Get internal method of O with the argument "length".
    // 3. Let len be ToUint32(lenValue).
    var len = O.length >>> 0;

    // 4. If IsCallable(callback) is false, throw a TypeError exception.
    // See: http://es5.github.com/#x9.11
    if (typeof callback !== "function") {
      throw new TypeError(callback + " is not a function");
    }

    // 5. If thisArg was supplied, let T be thisArg; else let T be undefined.
    if (thisArg) {
      T = thisArg;
    }

    // 6. Let A be a new array created as if by the expression new Array(len) where Array is
    // the standard built-in constructor with that name and len is the value of len.
    A = new Array(len);

    // 7. Let k be 0
    k = 0;

    // 8. Repeat, while k < len
    while(k < len) {

      var kValue, mappedValue;

      // a. Let Pk be ToString(k).
      //   This is implicit for LHS operands of the in operator
      // b. Let kPresent be the result of calling the HasProperty internal method of O with argument Pk.
      //   This step can be combined with c
      // c. If kPresent is true, then
      if (k in O) {

        // i. Let kValue be the result of calling the Get internal method of O with argument Pk.
        kValue = O[ k ];

        // ii. Let mappedValue be the result of calling the Call internal method of callback
        // with T as the this value and argument list containing kValue, k, and O.
        mappedValue = callback.call(T, kValue, k, O);

        // iii. Call the DefineOwnProperty internal method of A with arguments
        // Pk, Property Descriptor {Value: mappedValue, : true, Enumerable: true, Configurable: true},
        // and false.

        // In browsers that support Object.defineProperty, use the following:
        // Object.defineProperty(A, Pk, { value: mappedValue, writable: true, enumerable: true, configurable: true });

        // For best browser support, use the following:
        A[ k ] = mappedValue;
      }
      // d. Increase k by 1.
      k++;
    }

    // 9. return A
    return A;
  };
}
