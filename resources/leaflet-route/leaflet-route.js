
L.Route = L.FeatureGroup.extend({
    initialize: function (routes, stops, options) {
        L.setOptions(this, options);

        this._layers = {};

        this._routeMasters = {};

        for (var i in routes.features) {
            var route = routes.features[i];

            if ("routeMaster" in route.properties) {
                var routeMaster = route.properties.routeMaster;

                if (routeMaster in this._routeMasters) {
                    this._routeMasters[routeMaster].routes.push(route);
                } else {
                    this._routeMasters[routeMaster] = {
                        name: routeMaster,
                        routes: [ route ]
                    };
                }
            } else {
                this._routeMasters[route.properties.ref] = {
                    name: route.properties.ref,
                    routes: [ route ]
                };
            }
        }

        this._routes = routes;
        this._busStops = {};

        for (i in stops.features) {
            var busStop = stops.features[i];

            this._busStops[busStop.properties.uri] = busStop;
        }

        var routeLayers = this._routeLayers = {}
        this._routeLayer = new L.GeoJSON(routes, {
            onEachFeature: function(feature, layer) {
                routeLayers[feature.properties.name] = layer;

                if (options.routeOptions.onEachFeature) {
                    options.routeOptions.onEachFeature(feature, layer);
                }
            },
            style: options.routeOptions.style
        });
        this.addLayer(this._routeLayer);

        var stopLayers = this._stopLayers = {};
        this._stopLayer = new L.GeoJSON(stops, {
            onEachFeature: function(feature, layer) {
                stopLayers[feature.properties.uri] = layer;

                if (options.stopOptions.onEachFeature) {
                    options.stopOptions.onEachFeature(feature, layer);
                }
            },
            pointToLayer: function (feature, latlng) {
                return L.circleMarker(latlng, {
                    radius: 8,
                    opacity: 0,
                });
            },
            style: function(feature) {
                return {
                    radius: 8,
                    opacity: 0,
                    fillOpacity: 0
                };
            }
        });
        this.addLayer(this._stopLayer);
    },
    getRouteMasters: function() {
        return this._routeMasters;
    },
    getRoutesForRouteMaster: function(id) {
        return this._routeMasters[id];
    },
    getRoutes: function() {
        return this._routes;
    },
    getStops: function() {
        return this._busStops;
    },
    highlightRoute: function(id) {
        var layer = this._routeLayers[id];

        layer.setStyle({
            weight: 10,
            opacity: 1,
        });

        layer.setText('\u25BA', {
            repeat: true,
            offset: 3,
            attributes: {
                fill: 'black',
                fontSize: 24
            }
        });

        layer.bringToFront();
    },
    resetRoute: function(id) {
        var layer = this._routeLayers[id];

        this._routeLayer.resetStyle(layer);

        layer.setText(null);
    },
    resetRoutes: function() {
        Object.keys(this._routeLayers).forEach(this.resetRoute, this);
    },
    highlightStop: function(id) {
        var layer = this._stopLayers[id];

        layer.setStyle({
            color: '#ff0000',
            opacity: 1,
            fillOpacity: 0.3,
            radius: 16,
            stroke: true,
            fill: true
        });
    },
    resetStop: function(id) {
        var layer = this._stopLayers[id];

        this._stopLayer.resetStyle(layer);
    },
    panToStop: function(id, panOptions) {
        var layer = this._stopLayers[id];

        this._map.panTo(layer._latlng, panOptions);
    }
});

L.Control.Route = L.Control.Sidebar.extend({
    initialize: function (routeLayer, placeholder, options) {
        L.Control.Sidebar.prototype.initialize.call(this, placeholder, options);
        L.setOptions(this, options);

        this._routeLayer = routeLayer;

        var title = L.DomUtil.create('div', 'ls-routes-title', this._contentContainer);
        title.textContent = "University Bus Routes";

        var routeMasters = this._routeLayer.getRouteMasters();

        var routeMasterRouteLists = {};

        var ul = L.DomUtil.create('ul', 'ls-route-master-list', this._contentContainer);

        var routeMasterNames = Object.keys(routeMasters);
        if (this.options.routeMasterSort) {
            routeMasterNames.sort(this.options.routeMasterSort);
        }

        for (var i in routeMasterNames) {
            var routeMasterName = routeMasterNames[i];
            var routeMaster = routeMasters[routeMasterName];

            var li = L.DomUtil.create('li', '', ul);
            var a = L.DomUtil.create('a', '', li);

            a.style.background = routeMaster.routes[0].properties.colour;

            a.textContent = routeMaster.name;
            a.onclick = (function(routeMasterName) {
                return function() {
                    routeMasterRouteLists[activeRouteMaster].style.display = "none";
                    routeMasterRouteLists[routeMasterName].style.display = "block";
                    activeRouteMaster = routeMasterName;
                };
            })(routeMasterName);

            // The route lists

            var routeList = this._createRouteList(routeMaster);
            routeMasterRouteLists[routeMasterName] = routeList;

            routeList.style.display = "none";

            this._contentContainer.appendChild(routeList);
        }

        var activeRouteMaster = "U1"; // TODO: Dont hardcode like this

        routeMasterRouteLists[activeRouteMaster].style.display = "block";
    },
    _createRouteList: function(routeMaster) {
        var div = L.DomUtil.create('div', null);

        var ul = L.DomUtil.create('ul', 'ls-route-list', div);

        var routeLayer = this._routeLayer;

        var stopLists = {};
        for (var i in routeMaster.routes) {
            var route = routeMaster.routes[i];

            var li = L.DomUtil.create('li', '', ul);
            var a = L.DomUtil.create('a', null, li);

            //a.style.borderColor = route.properties.colour;
            a.style.background = route.properties.colour;

            a.textContent = route.properties.ref;
            a.onclick = (function(routeName) {
                return function() {
                    routeLayer.resetRoutes();
                    stopLists[activeStopList].style.display = "none";
                    stopLists[routeName].style.display = "block";
                    activeStopList = routeName;
                    routeLayer.highlightRoute(routeName);
                };
            })(route.properties.name);

            // The stops

            var stopList = this._createStopList(route);
            stopLists[route.properties.name] = stopList;

            stopList.style.display = "none";

            div.appendChild(stopList);
        }

        var activeStopList = routeMaster.routes[0].properties.name;
        stopLists[activeStopList].style.display = "block";
        //routeLayer.highlightRoute(activeStopList);

        return div;
    },
    _createStopList: function(route) {
        var div = L.DomUtil.create('div', null, this._div);

        var description = L.DomUtil.create('div', 'ls-route-description', div);
        description.textContent = route.properties.name.split(": ")[1].replace("=>", "\u2192");

        var ul = L.DomUtil.create('ul', 'ls-stop-list', div);

        ul.style.listStyleImage = "url(" + LS.imagePath + "bus_stop.png)";

        var routeLayer = this._routeLayer;
        var busStops = routeLayer.getStops();

        for (var i in route.properties.stops) {
            var stop = route.properties.stops[i];

            var li = L.DomUtil.create('li', '', ul);

            var busStop = busStops[stop];

            var a = L.DomUtil.create('a', '', li);

            if (typeof(busStop) !== "undefined") {
                a.textContent = busStop.properties.name;
                a.onclick = (function(uri) {
                    return function() {
                        routeLayer.panToStop(uri, {
                            animate: true
                        });
                    };
                })(busStop.properties.uri);
                a.onmouseover = (function(uri) {
                    return function() {
                        routeLayer.highlightStop(uri);
                    };
                })(busStop.properties.uri);
                a.onmouseout = (function(uri) {
                    return function() {
                        routeLayer.resetStop(uri);
                    };
                })(busStop.properties.uri);
            } else {
                a.textContent = "Name Unknown";
            }
        }

        return div;
    }
});

L.Control.ShowRouteSidebar = L.Control.extend({
    options: {
        position: 'topleft',
    },

    initialize: function(sidebar, options) {
        this._sidebar = sidebar;
    },

    onAdd: function (map) {
        var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');

        var link = L.DomUtil.create('a', 'leaflet-bar-part leaflet-bar-part-single', container);
        link.href = '#';

        var sidebar = this._sidebar;

        L.DomEvent
            .on(link, 'click', L.DomEvent.stopPropagation)
            .on(link, 'click', L.DomEvent.preventDefault)
            .on(link, 'click', function() {
                sidebar.toggle();
            })
            .on(link, 'dblclick', L.DomEvent.stopPropagation);

        return container;
    }
});
