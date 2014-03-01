(function() {
    "use strict";

    var LS = window.LS = L.extend({}, L.Mixin.Events, {

        dataPath: 'data.json',
        imagePath: 'images/',
        data: null,
        _dataFetchInProgress: false,
        workstationData: null,
        _workstationDataFetchInProgress: false,

        getData: function(callback) {
            if (this.data !== null) {
                callback(this.data);
            } else {
                this.on("dataload", callback);

                if (!this._dataFetchInProgress) {
                    this._dataFetchInProgress = true;
                    getJSON({url: LS.dataPath} , function(data) {
                        LS.data = data;
                        LS._dataFetchInProgress = false;

                        LS.fire("dataload", data);
                    });
                }
            }
        },
        getWorkstationData: function(callback) {
            if (this.workstationData !== null) { // TODO: Some kind of periodic refresh
                callback(this.workstationData);
            } else {
                this.addOneTimeEventListener("workstationData", callback);
                if (!this._workstationDataFetchInProgress) {
                    this._workstationDataFetchInProgress = true;
                    this._updateWorkstationData();
                }
            }
        },
        getRoomFor: function(uri) {
            var parts = LS.data.buildingParts.features;

            for (var i=0; i<parts.length; i++) {
                var part = parts[i];

                if (part.properties.buildingpart !== "room")
                    continue;

                var contents = part.properties.contents;

                for (var j=0; j<contents.length; j++) {
                    var content = contents[j];

                    if (content.feature === uri) {
                        return part;
                    }
                }

                var features = part.properties.features;

                for (var j=0; j<features.length; j++) {
                    var feature = features[j];

                    if (feature.feature === uri) {
                        return part;
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
        _updateWorkstationData: function() {
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
                    LS.workstationData = {};

                    if (data === null) {
                        LS.fire("workstationData", null);
                        return;
                    }

                    data.results.bindings.forEach(function(result) {
                        var workstation = result.uri.value;
                        var id = "#" + workstation.split('/').slice(-1)[0];
                        var obj = {};

                        obj.total_seats = parseInt(result.total_seats.value, 10);
                        obj.free_seats = parseInt(result.free_seats.value, 10);
                        obj.status = result.status.value;

                        LS.workstationData[workstation] = obj;
                    });

                    LS._workstationDataFetchInProgress = false;

                    LS.fire("workstationData", LS.workstationData);
                }
            );
        }
    });

    var busRouteColours = {};

    var icons = {
        created: false,
        createIcons: function() {
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

    var emptyFeatureCollection = { type: "FeatureCollection", features: [] };
    var transparaentStyle = function(feature) {return {weight: 0, opacity: 0, fillOpacity: 0};};

    var layerNames = ['sites', 'parking', 'bicycleParking', 'buildings', 'busStops' /*'busRoutes',*/];

    var busRouteStyle = function(feature) {
        return {weight: 5, opacity: 0.5, color: feature.properties.colour};
    };

    LS.Map = L.Map.extend({
        options: {
            center: [50.9354, -1.3964],
            indoor: false,
            workstations: false,
            zoom: 17,
            tileUrl: 'http://bus.southampton.ac.uk/graphics/map/tiles/{z}/{x}/{y}.png',
            tileAttribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors'
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

            var overlayMaps = {
               //"Bus Routes": self.layers.busRoutes,
            };

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
                        } else if (layerName === "busRoutes") {
                            return busRouteStyle();
                        } else {
                            return blankStyle();
                        }
                    }
                };

                if (layerName === 'buildings') {
                    layerOptions.onEachFeature = function(feature, layer) {
                        // When the feature is clicked on
                        layer.on('click', function(e) {
                            var close;

                            var content = buildingTemplate(feature.properties,
                                                           options.indoor,
                                                           map,
                                                           function() { close(); });

                            close = showPopup(map, content, e.latlng);
                        });
                    };
                } else {
                    layerOptions.onEachFeature = function(feature, layer) {
                        // When the feature is clicked on
                        layer.on('click', function(e) {
                            var content = popupTemplates[layerName](feature.properties);

                            showPopup(map, content, e.latlng);
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

                if (layerName === "busStops") {
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

                LS.getWorkstationData(function(workstationData) {

                                                                       // Adding .features means leaflet will
                                                                       // ignore those without a geometry
                    map.indoorLayer = L.indoorLayer(data.buildingParts.features, {
                        level: map._startLevel,
                        style: function(feature) {
                            var fill = 'white';
                            if (feature.properties.buildingpart === 'corridor') {
                                fill = '#169EC6';
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
                                    content = "Room " + part.properties.ref;
                                } else if ("name" in part.properties) {
                                    content = part.properties.name;
                                } else {
                                    return;
                                }

                                if (partWorkstation) {
                                    if (partWorkstation.feature in workstationData) {
                                        var workstationIcon = '<div class="ls-workstationicon" style="margin-left: auto; margin-right: auto; background-image: url(' + LS.imagePath + 'workstation-group.png' + ')"><div style="padding-left: 26px;">';

                                        var freeSeats = workstationData[partWorkstation.feature].free_seats;

                                        workstationIcon += freeSeats + "</div></div>";

                                        content = workstationIcon + content;
                                    } else {
                                        var workstationIcon = '<div style="margin-left: auto; margin-right: auto; width: 32px; height: 32px; background-image: url(' + LS.imagePath + 'workstation.png' + ')"></div>';

                                        content = workstationIcon + content;
                                    }
                                }

                                var myIcon = L.divIcon({
                                    className: 'ls-room-marker',
                                    html: content,
                                    iconSize: new L.Point(100, 30),
                                    iconAnchor: new L.Point(50, 15)
                                });

                                var marker = L.marker(iconCoords, {icon: myIcon});

                                return marker;
                            }
                        },
                        onEachFeature: function(feature, layer) {
                            layer.on('click', function(e) {
                                var content;
                                var popupOptions = {};

                                // When the feature is clicked on
                                if ("buildingpart" in feature.properties) {
                                    content = roomPopupTemplate(feature.properties);
                                } else { // Assume that it is a printer
                                    // TODO: Use different icons where appropriate
                                    popupOptions.offset = icons.vendingHotDrinks.options.popupAnchor;

                                    if ('vending' in feature.properties) {
                                        content = vendingPopupTemplate(feature.properties);
                                    } else {
                                        content = printerPopupTemplate(feature.properties);
                                    }
                                }

                                showPopup(map, content, e.latlng, popupOptions);
                            });
                        },
                        pointToLayer: function (feature, latlng) {
                            var icon;

                            if ('vending' in feature.properties) {
                                if (feature.properties.vending === 'drinks') {
                                    icon = icons.vendingHotDrinks;
                                } else if (feature.properties.vending === 'sweets') {
                                    icon = icons.vendingSweets;
                                } else {
                                    console.warn("Unrecognired vending " + feature.properties.vending);
                                }
                            } else {
                                icon = icons.printer;
                            }

                            return L.marker(latlng, {icon: icon});
                        }
                    });

                    map.indoorLayer.addData(data.buildingFeatures);

                    map.levelControl = L.Control.level({
                        levels: map.indoorLayer.getLevels(),
                        level: map._startLevel
                    });

                    map.levelControl.addEventListener("levelchange", map.indoorLayer.setLevel, map.indoorLayer);

                    map.levelControl.on("levelchange", function(e) {
                        map.fireEvent("levelchange", e);
                    });

                    var workstationMarkerLayer;
                    if (options.workstations) {
                        workstationMarkerLayer = LS.workstationLayer();
                    }

                    if (options.indoor) {
                        var setIndoorContent = function(zoom) {
                            if (zoom <= 19) {
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
                            } else if (zoom > 19) {
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

                        setIndoorContent(map.getZoom());

                        map.on('zoomend', function(e) {
                            setIndoorContent(this.getZoom());
                        });
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
                    var close;

                    var content = buildingTemplate(building.properties,
                                               this.options.indoor,
                                               map,
                                               function() { close(); });

                    var temp = { _rings: building.geometry.coordinates, _map: this };


                    var center = building.geometry.coordinates[0][0];
                    center = [center[1], center[0]];

                    map.panTo(center);

                    close = showPopup(map, content, center);

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
                    this.setLevel(feature.properties.level);
                }

                this.closePopup();

                return;
            } else if (feature.geometry.type === "Point") {
                this.setView(L.GeoJSON.coordsToLatLng(feature.geometry.coordinates), 22);

                if ("level" in feature.properties) {
                    this.setLevel(feature.properties.level);
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
        }
    });

    LS.map = function (id, options) {
        return new LS.Map(id, options);
    };

    function showPopup(map, content, latlng, popupOptions) {
        popupOptions = popupOptions || {};

        popupOptions.maxWidth = map.getContainer().offsetWidth;

        var close;

        if (false && smallScreen()) {
            // Just in case there is a popup open, as the screen has just shrunk
            map.closePopup();

            var containerWrapper = document.getElementById('dynamicContentWrapper');
            containerWrapper.style.display = 'block';

            var container = document.getElementById('dynamicContent');

            var contentDiv = document.createElement('div');

            var closeButton = L.DomUtil.create('button', 'close', container);
            closeButton.setAttribute('aria-hidden', 'true');
            closeButton.setAttribute('type', 'button');
            closeButton.textContent = 'x';

            close = closeButton.onclick = function() {
                container.innerHTML = '';
                containerWrapper.style.display = 'none';
            };

            container.appendChild(content);
        } else {
            var popup = L.popup(popupOptions).setLatLng(latlng);

            popup.setContent(content);

            popup.openOn(map);

            close = function() {
                map.closePopup(popup);
            };
        }

        return close;
    }

    // Template functions for creating the popups

    var popupTemplates = {
        sites: siteTemplate,
        buildings: buildingTemplate,
        bicycleParking: bicycleParkingTemplate,
        parking: parkingTemplate,
        busStops: busStopTemplate
    };

    function roomPopupTemplate(properties) {
        properties = L.extend({}, properties);

        if (!("name" in properties)) {
            properties.name = "Room ";
            if ("ref" in properties) {
                properties.name += properties.ref;
            }
        }

        return getTemplateWrapper(properties, function(content) {

            var tabs = [
                {
                    id: 'features',
                    name: 'Features',
                    active: true
                },
                {
                    id: 'contents',
                    name: 'Contents',
                },
                {
                    id: 'bookings',
                    name: 'Bookings',
                },
                {
                    id: 'pictures',
                    name: 'Pictures',
                }];

            tabs = createTabs(tabs, content);

            if ('contents' in properties) {
                properties.contents.forEach(function(feature) {
                    createBlankLink(feature.feature, feature.label, tabs.features);

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

            if ('images' in properties) {
                properties.images.forEach(function(image) {

                });
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

    function buildingTemplate(properties, indoor, map, close) {
        return getTemplateWrapper(properties, function(content) {

            var buildingTabs = [
                {
                    id: 'picture',
                    name: 'Pictures',
                    active: true
                },
                {
                    id: 'energyUsage',
                    name: 'Energy Usage',
                }];

            if (indoor) {
                buildingTabs.push({
                    id: 'rooms',
                    name: 'Facilities',
                });

                buildingTabs.push({
                    id: 'services',
                    name: 'Services',
                });
            }

            var tabs = createTabs(buildingTabs, content);

            var imageWidth;
            var imageHeight;

            if (properties.images.length !== 0) {

                var versions = properties.images[0].versions;
                var url;

                for (var i=0; i<versions.length; i++) {
                    var version = versions[i];
                    url = version.url;

                    imageWidth = version.width;
                    imageHeight = version.height;

                    var mapContainer = map.getContainer();
                    var widthBound = mapContainer.offsetWidth;
                    var heightBound = mapContainer.offsetHeight;

                    if (!smallScreen()) {
                        widthBound *= 0.7;
                        heightBound *= 0.7;
                    }

                    if (imageWidth < widthBound &&
                        imageHeight < heightBound) {
                        break; // Use this image, as it is the first smaller
                               // than the screen width
                    }
                }

                if (url !== null) {
                    // Link to the biggest image (versions is sorted by size on the server)
                    var imageLink = createBlankLink(versions[0].url, false, tabs.picture);

                    tabs.picture.style.minWidth = imageWidth + "px";
                    tabs.picture.style.minHeight = imageHeight + "px";

                    var image = document.createElement('img');
                    image.setAttribute('src', url);
                    image.setAttribute('width', imageWidth);
                    image.setAttribute('height', imageHeight);

                    imageLink.appendChild(image);

                    //createBlankLink(properties.images[0].licence, "Licence", tabs.picture);
                } else {
                    tabs.picture.textContent = "No Image Available";
                }
            } else {

            }

            var energyIFrame = document.createElement('iframe');
            energyIFrame.setAttribute('src', 'http://data.southampton.ac.uk/time-series?action=fetch&series=elec/b' + properties.loc_ref + '/ekw&type=average&format=graph&resolution=3600&startTime=1375009698000.0');
            energyIFrame.setAttribute('frameBorder', '0');
            energyIFrame.setAttribute('style', 'width: 100%; height 100%;');

            tabs.energyUsage.style.minWidth = imageWidth + "px";
            tabs.energyUsage.style.minHeight = imageHeight + "px";
            tabs.energyUsage.appendChild(energyIFrame);

            createBlankLink('http://data.southampton.ac.uk/time-series?action=fetch&series=elec/b' + properties.loc_ref + '/ekw&type=average&format=graph&resolution=3600&startTime=0', 'Graph for all time', tabs.energyUsage);

            // Rooms
            if (indoor) {

                tabs.rooms.style.minWidth = imageWidth + "px";
                tabs.rooms.style.minHeight = imageHeight + "px";

                tabs.rooms.style.maxWidth = imageWidth + "px";
                tabs.rooms.style.maxHeight = imageHeight + "px";

                tabs.rooms.style.overflow = 'scroll';

                for (var level in properties.rooms) {
                    var rooms = properties.rooms[level];

                    // Heading

                    var panelTitle = L.DomUtil.create('h4', '', tabs.rooms);
                    panelTitle.textContent = "Level " + level;

                    // Content

                    var contentPanel = L.DomUtil.create('div', '', tabs.rooms);

                    rooms.forEach(function(uri) {
                        var room = LS.getFeatureByURI(uri);

                        if (room === null) {
                            console.err("Unable to find room " + uri);
                            return;
                        }

                        var teachingAndBookable = "";

                        if (room.properties.teaching) {
                            teachingAndBookable += " (T) ";
                        }

                        if (room.properties.teaching) {
                            teachingAndBookable += " (B)";
                        }

                        var roomProps = document.createTextNode(teachingAndBookable);

                        var description = room.properties.ref;
                        if ("name" in room.properties) {
                            description += ":  " + room.properties.name;
                        }

                        if ("center" in room.properties) {
                            var roomLink = createLink('#', false, tabs.rooms);

                            roomLink.onclick = function() {
                                close();
                                map.showByURI(uri);
                            };

                            roomLink.textContent = description;
                        } else {
                            var roomText = document.createTextNode(description);

                            tabs.rooms.appendChild(roomText);
                        }

                        tabs.rooms.appendChild(roomProps);

                        var moreInfo = createBlankLink(uri, "(More Information)", tabs.rooms);
                        moreInfo.style.cssFloat = moreInfo.style.styleFloat = "right";

                        tabs.rooms.appendChild(document.createElement('br'));
                    });
                }

                tabs.services.style.minWidth = imageWidth + "px";
                tabs.services.style.minHeight = imageHeight + "px";

                tabs.services.style.maxWidth = imageWidth + "px";
                tabs.services.style.maxHeight = imageHeight + "px";

                tabs.services.style.overflow = 'scroll';

                if ("services" in properties) {
                    if ("vendingMachines" in properties.services) {
                        title = L.DomUtil.create('h4', '', tabs.services);
                        title.textContent = "Vending Machines";

                        properties.services.vendingMachines.forEach(function(machine) {
                            var feature = LS.getFeatureByURI(machine);

                            if (feature === null) {
                                console.error("no feature for " + machine);
                                return;
                            }

                            if ("geometry" in feature) {
                                var machineLink = createLink('#', false, tabs.services);

                                machineLink.onclick = function() {
                                    close();
                                    map.showByURI(machine);
                                };

                                machineLink.textContent = feature.properties.label;
                            } else {
                                var note = document.createTextNode(feature.properties.label);

                                tabs.services.appendChild(note);
                            }

                            var moreInfo = createBlankLink(machine, "(More Information)", tabs.services);
                            moreInfo.style.cssFloat = moreInfo.style.styleFloat = "right";

                            tabs.services.appendChild(document.createElement('br'));
                        });
                    }

                    if ("mfds" in properties.services) {
                        var title = L.DomUtil.create('h4', '', tabs.services);
                        title.textContent = "Multi-Function Devices";

                        properties.services.mfds.forEach(function(mfd) {
                            var feature = LS.getFeatureByURI(mfd);

                            if (feature === null) {
                                console.error("no feature for " + mfd);
                                return;
                            }

                            if ("geometry" in feature) {
                                var mfdLink = createLink('#', false, tabs.services);

                                mfdLink.onclick = function() {
                                    close();
                                    map.showByURI(mfd);
                                };

                                mfdLink.textContent = feature.properties.label;
                            } else {
                                var note = document.createTextNode(feature.properties.label);

                                tabs.services.appendChild(note);
                            }

                            var moreInfo = createBlankLink(mfd, "(More Information)", tabs.services);
                            moreInfo.style.cssFloat = moreInfo.style.styleFloat = "right";

                            tabs.services.appendChild(document.createElement('br'));
                        });
                    }
                }
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

        /*<tr><td>Routes: \
            <%  each(properties.routes, function(route) { %>\
                    <font color="<%= route.colour %>"><%= route.ref %></font>\
            <%  }); %>\
        </td></tr>\
        <tr>\
            <td colspan=2><iframe width="400px" height="100%" style="border: solid 1px #000" src="<%\
                var parts = properties.uri.split("/");\
                var id = parts[parts.length - 1].split(".")[0];\
                print("http://data.southampton.ac.uk/bus-stop/" + id + ".html?view=iframe");\
            %>" frameBorder="0"></iframe></td>\
        </tr>\*/

            /*var parts = properties.uri.split("/");
            var id = parts[parts.length - 1].split(".")[0];
            var src = "http://data.southampton.ac.uk/bus-stop/" + id + ".html?view=iframe";

            var energyIFrame = document.createElement('iframe');
            energyIFrame.setAttribute('src', src);
            energyIFrame.setAttribute('frameBorder', '0');
            energyIFrame.setAttribute('style', 'width: 100%; height 100%;');

            content.appendChild(energyIFrame);*/

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
        var table = document.createElement('table');

        table.classList.add("ls-content-table");

        table.setAttribute('style', 'width: 100%');

        var headingRow = document.createElement('tr');
        table.appendChild(headingRow);

        var titleData = document.createElement('td');
        headingRow.appendChild(titleData);

        var title = document.createElement('h2');
        title.classList.add("ls-popup-title");
        titleData.appendChild(title);

        var titleText = "";

        if ('loc_ref' in properties) {
            titleText += properties.loc_ref + ' ';
        }

        if ('name' in properties) {
            titleText += properties.name;
        }

        title.textContent = titleText;

        var moreInfo = L.DomUtil.create('td', '', headingRow);
        moreInfo.setAttribute('align', 'right');

        if ('uri' in properties) {
            createBlankLink(properties.uri, '(More Information)', moreInfo);
        }

        var contentRow = L.DomUtil.create('tr', '', table);

        var contentData = L.DomUtil.create('td', '', contentRow);
        contentData.setAttribute('colspan', '2');

        contentFunction(contentData);

        return table;
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
        xhttp.timeout = 2000;

        options.data = options.data || null;

        xhttp.open('GET', options.url, true);
        xhttp.setRequestHeader('Accept', 'application/json');

        xhttp.send(options.data);
        xhttp.onreadystatechange = function() {
            if (xhttp.status == 200 && xhttp.readyState == 4) {
                callback(JSON.parse(xhttp.responseText));
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

                        showPopup(this._map, content, a.latlng, popupOptions);
                    }).on('clusterclick', function (a) {
                        var uris = a.layer.getAllChildMarkers().map(function(marker) {
                            return marker.uri;
                        });

                        var popupOptions = {offset: [0, -15]};

                        var content = workstationsTemplate(uris);

                        showPopup(this._map, content, a.latlng, popupOptions);
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

L.Control.Level = L.Control.extend({
    includes: L.Mixin.Events,

    options: {
        position: 'bottomright',
        parseLevel: function(level) {
            return parseInt(level, 10);
        }
    },

    initialize: function(options) {
        L.setOptions(this, options);

        this._map = null;
        this._buttons = {};
        this._listeners = [];
        this._level = options.level;

        this.addEventListener("levelchange", this._levelChange, this);
    },
    onAdd: function(map) {
        var div = L.DomUtil.create('div', 'ls-levelselector');

        var btnGroup = L.DomUtil.create('div', 'ls-btn-group', div);

        var buttons = this._buttons;
        var activeLevel = this._level;
        var self = this;

        this.options.levels.forEach(function(level) {
            var cls = 'ls-btn';

            var levelNum = self.options.parseLevel(level);

            if (level === activeLevel || levelNum === activeLevel)
                cls += ' active';

            var levelBtn = L.DomUtil.create('button', cls, btnGroup);

            levelBtn.appendChild(levelBtn.ownerDocument.createTextNode(level));

            levelBtn.onclick = function() {
                self.setLevel(level);
            };

            buttons[level] = levelBtn;
        });

        return div;
    },
    _levelChange: function(e) {
        // Probably won't work in some browsers, see
        // https://developer.mozilla.org/en-US/docs/Web/API/element.classList

        if (this._map !== null) {
            this._buttons[e.oldLevel].classList.remove('active');
            this._buttons[e.newLevel].classList.add('active');
        }
    },
    setLevel: function(level) {

        if (level === this._level)
            return;

        var oldLevel = this._level;
        this._level = level;

        this.fireEvent("levelchange", {
            oldLevel: oldLevel,
            newLevel: level
        });
    },
    getLevel: function() {
        return this._level;
    }
});

L.Control.level = function (options) {
    return new L.Control.Level(options);
};

/**
 * A layer that will display indoor data
 *
 * addData takes a GeoJSON feature collection, each feature must have a level
 * property that indicates the level. If the level is a string, some function
 * will be used to rank the levels.
 *
 * getLevels can be called to get the array of levels that are present.
 *
 *
 */

L.IndoorLayer = L.Class.extend({

    initialize: function(data, options) {
        L.setOptions(this, options);

        var onEachFeature = options.onEachFeature;
        var layers = this._layers = {};
        this._map = null;
        if ("level" in options) {
            this._level = options.level;
        } else {
            this._level = null;
        }

        this.options.onEachFeature = function(feature, layer) {

            onEachFeature(feature, layer);

            var marker = options.markerForFeature(feature);
            if (typeof(marker) !== 'undefined') {
                marker.on('click', function(e) {
                    layer.fire('click', e);
                });

                layers[feature.properties.level].addLayer(marker);
            }
        };

        this.addData(data);
    },
    addTo: function (map) {
        map.addLayer(this);
        return this;
    },
    onAdd: function (map) {
        this._map = map;

        if (this._level === null) {
            var levels = this.getLevels();

            if (levels.length !== 0) {
                this._level = levels[0];
            }
        }

        this._map.addLayer(this._layers[this._level]);
    },
    onRemove: function (map) {
        this._map.removeLayer(this._layers[this._level]);
        this._map = null;
    },
    addData: function(data) {
        var layers = this._layers;

        var options = this.options;

        var features = L.Util.isArray(data) ? data : data.features;

        features.forEach(function (part) {
            var level = part.properties.level;
            var layer;

            if (typeof level === 'undefined')
                return;

            if (!("geometry" in part)) {
                return;
            }

            if (L.Util.isArray(level)) {
                level.forEach(function(level) {
                    if (level in layers) {
                        layer = layers[level];
                    } else {
                        layer = layers[level] = L.geoJson({ type: "FeatureCollection", features: [] }, options);
                    }

                    layer.addData(part);
                });
            } else {
                if (level in layers) {
                    layer = layers[level];
                } else {
                    layer = layers[level] = L.geoJson({ type: "FeatureCollection", features: [] }, options);
                }

                layer.addData(part);
            }
        });
    },
    getLevels: function() {
        return Object.keys(this._layers);
    },
    getLevel: function() {
        return this._level;
    },
    setLevel: function(level) {
        if (typeof(level) === 'object') {
            level = level.newLevel;
        }

        if (this._level === level)
            return;

        var oldLayer = this._layers[this._level];
        var layer = this._layers[level];

        if (this._map !== null) {
            this._map.removeLayer(oldLayer);
            this._map.addLayer(layer);
        }

        this._level = level;
    }
});

L.indoorLayer = function(data, options) {
    return new L.IndoorLayer(data, options);
};

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
    return new L.IndoorLayer(data, options);
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
