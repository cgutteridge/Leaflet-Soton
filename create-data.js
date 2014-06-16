#!/usr/bin/env node

/*
 * This does two things, combines University Open Data, and the data from the
 * osm2pgsql tables in the database to add more information back in to the
 * database for the tile renderer. It also produces the static json files used
 * by the web clients.
 */

var S = require('string');
S.extendPrototype();

var fs = require('fs');
var http = require("http");
var async = require("async");
var yaml = require('js-yaml');

var config = require("./config.json");

try {
    var printers = yaml.safeLoad(fs.readFileSync('./resources/mfd-location/data.yaml', 'utf8'));
} catch (e) {
    console.error(e);
    return;
}

var validationByURI = {};

// prefix for the database tables
var tablePrefix = "uni_";

var pgql = require('pg');
var pg = null;
pgql.connect('tcp://' + config.user + ':' +
             config.password + '@' +
             config.server + ':' +
             config.port + '/' +
             config.database, function(err, client) {
    if (err) {
        console.error(err);
        return;
    }

    pg = client;

    async.waterfall([
        // Creates the database tables that can be created with a simple query
        createTables,
        // Get the data from these tables
        createCollections,
        // Now the basic collections have been created, handle the more complicated
        // ones:
        //  - busStops
        //  - busRoutes
        //  - buildingParts
        //  - buildingFeatures
        //  - workstations
        //
        // Extracting the data for these is a bit harder than the simpler
        // collections.
        function(collections, callback) {

            // Create an object with the buildings in for easy lookup
            var buildings = {};

            collections.buildings.features.forEach(function(building) {
                if ("uri" in building.properties) {
                    buildings[building.properties.uri] = building;
                }
            });

            createBuildingParts(buildings, function(err, buildingParts, workstations) {

                collections.buildingParts = buildingParts;

                async.parallel([
                    function(callback) {
                        getBuildingFeatures(buildings, function(err, buildingFeatures) {
                            collections.buildingFeatures = buildingFeatures;
                            callback(err);
                        });
                    },
                    function(callback) {
                        getUniWorkstations(workstations, function(err, workstations) {
                            collections.workstations = workstations;
                            callback(err);
                        });
                    }
                ], function(err) {
                    getBuildingImages(buildings, function(err) {
                        callback(err, collections);
                    });
                });
            });
        },
        loadBusData
    ],
    function(err, collections){
        if (err) {
            console.error(err);
            process.exit(1);
        }

        console.info("ending database connection");
        pgql.end();
        writeDataFiles(collections, function() {

            Object.keys(validationByURI).sort().forEach(function(uri) {
                if ("location" in validationByURI[uri].errors) {
                    console.warn(uri + " location unknown");
                }
            });

            console.info("complete");

            process.exit(0);
        });
    });
});

// This code handles creating the basic collections, that is:
//  - buildings
//  - parking
//  - bicycleParking
//  - sites
//  - busStops
//
// It is done this way, as this is the data that has to be loaded in to the
// database for the renderer to work.

function createTables(callback) {
    var tableSelects = {
        site: "select way,name,loc_ref,uri,amenity,landuse \
                from planet_osm_polygon \
                where operator='University of Southampton'",
        building: 'select way,coalesce("addr:housename", name, \'\') as name,coalesce(height::int, "building:levels"::int * 10, 10) as height,loc_ref,leisure,uri, case when coalesce("addr:housename", name, \'\')=\'\' or "addr:housename"="addr:housenumber" then true else false end as minor from planet_osm_polygon where ST_Contains((select ST_Union(way) from uni_site), way) and building is not null order by z_order,way_area desc',
        parking: 'select way,name,access,capacity,"capacity:disabled",fee from planet_osm_polygon where amenity=\'parking\' and ST_Contains((select ST_Union(way) from uni_site), way)',
        bicycle_parking: "select way,capacity,bicycle_parking,covered from planet_osm_polygon where amenity='bicycle_parking' and ST_Contains((select ST_Union(way) from uni_site), way) union select way,capacity,bicycle_parking,covered from planet_osm_point where amenity='bicycle_parking' and ST_Contains((select ST_Union(way) from uni_site), way)"
    };

    // Create all the tables, these contain Universtiy relevant data that is
    // both further queried, and used by sum-carto
    async.eachSeries(Object.keys(tableSelects), function(table, callback) {
        createTable(table, tableSelects[table], callback);
    }, callback);
}

function createTable(name, query, callback) {
    var tableName = tablePrefix + name;

    console.info("creating table " + tableName);

    pg.query("drop table if exists " + tableName, function(err, results) {
        var fullQuery = "create table " + tableName + " as " + query;
        pg.query(fullQuery, function(err, results) {
            if (err) {
                console.error("error creating table " + tableName);
                console.error("query: " + fullQuery);
            } else {
                console.info("finished creating table " + tableName);
            }
            callback(err);
        });
    });
}

function createCollections(callback) {
    var collectionQueries = {
        buildings: 'select ST_AsGeoJSON(ST_Transform(way, 4326), 10) as \
                   polygon,name,loc_ref,uri,leisure,height \
                   from uni_building where uri is not null',
        parking: 'select ST_AsGeoJSON(ST_Transform(way, 4326), 10) as polygon,\
                 name,access,capacity,"capacity:disabled",fee from uni_parking',
        bicycleParking: 'select ST_AsGeoJSON(ST_Transform(way, 4326), 10) as polygon,capacity,bicycle_parking,covered from uni_bicycle_parking',
        sites: 'select ST_AsGeoJSON(ST_Transform(way, 4326), 10) as polygon,name,loc_ref,uri from uni_site'
    };

    var names = Object.keys(collectionQueries);

    async.map(names, function(name, callback) {
        createCollection(name, collectionQueries[name], callback);
    }, function(err, newCollections) {
        var collectionsObject = {};

        for (var i in names) {
            name = names[i];

            collectionsObject[name] = {
                type: "FeatureCollection",
                features: newCollections[i]
            };
        }

        callback(err, collectionsObject);
    });
}

function createCollection(name, query, callback) {
    var collection = [];

    pg.query(query, function(err, results) {
        if (err) {
            console.error("Query: " + query);
            console.error(err);
            callback(err);
            return;
        }

        async.map(results.rows, function(row, callback) {
            var feature = {type: "Feature"};
            feature.geometry = JSON.parse(row.polygon);
            delete row.polygon;

            feature.properties = row;

            for (var key in feature.properties) {
                if (feature.properties[key] === null) {
                    delete feature.properties[key];
                }
            }

            if ("center" in feature.properties) {
                var center = feature.properties.center;
                center = center.slice(6, -1);
                center = center.split(" ").reverse();
                feature.properties.center = center;
            }

            callback(err, feature);
        }, callback);
    });
}

// buildingFeatures

function getBuildingFeatures(buildings, callback) {
    async.parallel([
        function(callback) {
            getPrinters(buildings, callback);
        },
        function(callback) {
            getVendingMachines(buildings, callback);
        }
    ], function(err, results) {
        var features = []
        features = features.concat.apply(features, results);

        var buildingFeatures = {
            type: "FeatureCollection",
            features: features
        };

        callback(err, buildingFeatures);
    });
}

function getBuildingImages(buildings, callback) {
    console.info("getting building images");
    async.each(Object.keys(buildings), function(uri, callback) {
        getImagesFor(uri, function(err, images) {
            buildings[uri].properties.images = images;
            callback(err);
        });
    }, callback);
}

// buildingParts

function processBuildingParts(buildingParts, callback) {
    var buildingPartsByURI = {};
    var workstations = {};

    async.each(buildingParts, function(part, callback) {
        if (part.properties.buildingpart === "room") {
            if ("uri" in part.properties) {
                buildingPartsByURI[part.properties.uri] = part;

                var expectedRef = part.properties.uri.split("/").slice(-1)[0].split("-")[1];

                if ("ref" in part.properties) {
                    if (part.properties.ref !== expectedRef) {
                        console.warn("Unexpected ref \"" + part.properties.ref + "\" for room " + part.properties.uri);
                    }
                } else {
                    console.warn("Missing ref \"" + expectedRef + "\" for room " + part.properties.uri);
                }

                async.parallel([
                    function(callback) {
                        findRoomFeatures(part, callback);
                    },
                    function(callback) {
                        findRoomContents(part, workstations, callback);
                    },
                    function(callback) {
                        findRoomImages(part, callback);
                    }],
                callback);
            } else {
                console.warn("room has no URI " + JSON.stringify(part.properties.center));
                callback();
            }
        } else {
            callback();
        }
    }, function(err) {
        // list such that it fits within async's pattern
        callback(err, [buildingPartsByURI, workstations]);
    });
}

function getPartToLevelMap(buildingRelations, callback) {
    var levelRelations = [];

    // Process level relations
    async.each(buildingRelations, function(buildingRelation, callback) {
        getLevelRelations(buildingRelation, function(err, newLevelRelations) {
            levelRelations.push.apply(levelRelations, newLevelRelations);
            callback();
        });
    }, function(err) {

        osmIDToLevels = {};

        async.each(levelRelations, function(level, callback) {
            getBuildingPartMemberRefs(level, function(err, refs) {
                for (var i=0; i<refs.length; i++) {
                    var ref = refs[i];

                    if (!(ref in osmIDToLevels)) {
                        osmIDToLevels[ref] = [];
                    }

                    osmIDToLevels[refs[i]].push(parseInt(level.tags.level, 10));
                }
                callback();
            });
        }, function(err) {
            callback(osmIDToLevels);
        });
    });
}

function mergeUniversityDataWithBuildingParts(buildingParts, buildingPartsByURI, buildings, callback) {

    // This query might be better, but does not quite work (rooms are missing)
    /*
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX ns1: <http://vocab.deri.ie/rooms#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX spacerel: <http://data.ordnancesurvey.co.uk/ontology/spatialrelations/>
PREFIX soton: <http://id.southampton.ac.uk/ns/>
SELECT ?room ?type ?label ?building WHERE {
  ?room a ns1:Room .
  OPTIONAL { ?room spacerel:within ?building } .
  OPTIONAL { ?room rdfs:label ?label } .
  OPTIONAL { ?room rdf:type ?type }
}
     */

    // This seems to not pick up much...
    var query = "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
    PREFIX ns1: <http://vocab.deri.ie/rooms#>\
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
    PREFIX spacerel: <http://data.ordnancesurvey.co.uk/ontology/spatialrelations/>\
    PREFIX soton: <http://id.southampton.ac.uk/ns/>\
    SELECT * WHERE {\
        { ?room a ns1:Room ;\
              rdf:type ?type ;\
              rdfs:label ?label ;\
              spacerel:within ?building .\
        } UNION {\
          ?room a soton:SyllabusLocation ;\
              rdf:type ?type ;\
              rdfs:label ?label ;\
              spacerel:within ?building .\
        }\
    }";

    sparqlQuery(query, function(err, data) {
        if (err) {
            console.error("Query " + query);
            console.error(err);
        }

        console.log("Got building parts sparql query back");

        /*if ('error-message' in result) {
            console.error("error in createBuildingParts");
            console.error(result);
            console.error("query " + query);
            callback(result);
            return;
        }*/

        var rooms = {};

        data.results.bindings.forEach(function(result) {
            var uri = result.room.value;
            var type = result.type.value;
            var label = result.label.value;
            var building = result.building.value;

            if (uri in rooms) {
                var room = rooms[uri];

                if (room.types.indexOf(type) === -1) {
                    room.types.push(type);
                }
            } else {
                rooms[uri] = {
                    types: [type],
                    label: label,
                    building: building
                };
            }
        });

        Object.keys(rooms).forEach(function(uri) {
            var room = rooms[uri];

            var feature;

            if (uri in buildingPartsByURI) {
                feature = buildingPartsByURI[uri];
            } else {
                feature = {
                    type: "Feature",
                    properties: {
                        uri: uri
                    }
                };

                var info = decomposeRoomURI(uri);

                if (typeof(info) !== "undefined") {
                    feature.properties.ref = info.room;
                    feature.properties.level = info.level;
                }

                buildingParts.push(feature);
            }

            if (room.types.indexOf("http://id.southampton.ac.uk/ns/CentrallyBookableSyllabusLocation") !== -1) {
                feature.properties.teaching = true;
                feature.properties.bookable = true;
            } else if (room.types.indexOf("http://id.southampton.ac.uk/ns/SyllabusLocation") !== -1) {
                feature.properties.teaching = true;
                feature.properties.bookable = false;
            } else {
                feature.properties.teaching = false;
                feature.properties.bookable = false;
            }

            if (feature.properties.teaching && !("geometry" in feature)) {
                addRoomMessage(uri, "errors", "location", "unknown (teaching)");
            }

            if (!("name" in feature.properties)) {
                feature.properties.name = room.label;
            }

            if (room.building in buildings) {
                var buildingProperties = buildings[room.building].properties;

                if (!('rooms' in buildingProperties)) {
                    buildingProperties.rooms = {};
                }

                if ("level" in feature.properties) {
                    var level = feature.properties.level;

                    if (!(level in buildingProperties.rooms)) {
                        buildingProperties.rooms[level] = [];
                    }

                    buildingProperties.rooms[level].push(uri);
                } else {
                    console.warn("no level for " + JSON.stringify(feature, null, 4));
                }
            } else {
                addBuildingMessage(building, "errors", "location", "unknown (createBuildingParts)");
            }
        });

        callback();
    });
}

function createBuildingParts(buildings, callback) {
    console.info("creating buildingParts collection");

    // get the buildingParts and buildingRelations from the database
    //  - buildingParts are the ways tagged with buildingpart
    //  - buildingRelations are all the building relations
    async.parallel([getBuildingParts, getBuildingRelations],
        function(err, results) {

            // The objects in this array are modified
            var buildingParts = results[0];
            var buildingRelations = results[1];

            async.parallel([
                // for each room, find the features, contents and images
                function(callback) {
                    processBuildingParts(buildingParts, callback);
                },
                // determine the level for the building parts
                function(callback) {
                    getPartToLevelMap(buildingRelations, function(osmIDToLevels) {

                        // Assign levels to parts

                        buildingParts.forEach(function(part) {
                            if (part.id in osmIDToLevels) {
                                part.properties.level = osmIDToLevels[part.id];

                                part.properties.level.sort(function(a,b){return a-b});

                                if (part.properties.level.length === 1) {
                                    part.properties.level = part.properties.level[0];
                                }
                            } else {
                                console.warn("unknown level " + JSON.stringify(part.properties.center));
                            }
                        });

                        callback(err);
                    });
                }], function(err, results) {
                    var buildingPartsByURI = results[0][0];
                    var workstations = results[0][1];

                    console.log("begining merge");

                    mergeUniversityDataWithBuildingParts(buildingParts, buildingPartsByURI, buildings, function(err) {

                        console.log("finishing createBuildingParts");
                        callback(err, {
                            type: "FeatureCollection",
                            features: buildingParts
                        }, workstations);
                    });
                }
            );
        }
    );
}

function getBuildingPartMemberRefs(levelRelation, callback) {
    var partRefs = []

    for (var i=0; i<levelRelation.members.length; i++) {
        var member = levelRelation.members[i];

        if (member.role === 'buildingpart') {
            partRefs.push(member.ref);
        }
    }

    callback(null, partRefs);
}

function getBuildingParts(callback) {
    var query = "select ST_AsGeoJSON(ST_Transform(way, 4326), 10) as polygon,ST_AsText(ST_Transform(ST_Centroid(way), 4326)) as center,osm_id,name,buildingpart,\"buildingpart:verticalpassage\",ref,uri,amenity,unisex,male,female from planet_osm_polygon where buildingpart is not null";

    pg.query(query, function(err, results) {
        if (err) {
            console.error("Query: " + query);
            console.error(err);
            callback(err);
            return;
        }

        async.map(results.rows, function(part, callback) {
            var feature = {type: "Feature", id: part.osm_id};
            feature.geometry = JSON.parse(part.polygon);
            delete part.polygon;
            delete part.osm_id;

            feature.properties = part;

            for (var key in feature.properties) {
                if (feature.properties[key] === null) {
                    delete feature.properties[key];
                }
            }

            if ("center" in feature.properties) {
                var center = feature.properties.center;
                center = center.slice(6, -1);
                center = center.split(" ").reverse();
                feature.properties.center = center;
            }

            callback(null, feature);
        }, callback);
    });
}

function getBuildingRelations(callback) {
    var query = "select id,parts,members,tags from planet_osm_rels where (tags[1] = 'type' and tags[2] = 'building') or (tags[3] = 'type' and tags[4] = 'building')";

    pg.query(query, function(err, results) {
        if (err) {
            console.error("Query: " + query);
            console.error(err);
            callback(err);
            return;
        }

        async.map(results.rows, function(relation, callback) {
            processRelation(relation, callback);
        }, callback);
    });
}

function getLevelRelations(buildingRelation, callback) {
    var refs = [];
    for (var i=0; i<buildingRelation.members.length; i++) {
        var member = buildingRelation.members[i];
        if (member.role.slice(0, 5) === 'level') {
            refs.push(member.ref);
        }
    }

    getRelations(refs, function(err, relations) {
        callback(err, relations);
    });
}

function findRoomImages(room, callback) {
    getImagesFor(room.properties.uri, function(err, images) {
       room.properties.images = images;
       callback(err);
    });
}

function findRoomContents(room, workstations, callback) {
    var query = "PREFIX soton: <http://id.southampton.ac.uk/ns/>\
PREFIX geo: <http://www.w3.org/2003/01/geo/wgs84_pos#>\
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
PREFIX dct: <http://purl.org/dc/terms/>\
PREFIX spacerel: <http://data.ordnancesurvey.co.uk/ontology/spatialrelations/>\
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
SELECT * WHERE {\
?roomFeature spacerel:within <{{uri}}> ;\
     rdfs:label ?label ;\
     dct:subject ?subject ;\
}".template({ uri: room.properties.uri });

    sparqlQuery(query, function(err, data) {
        if (err) {
            console.error("Query " + query);
            console.error(err);
            callback(err);
            return;
        }

        //console.log("features: " + JSON.stringify(data, null, 4));

        room.properties.contents = [];

        featureDuplicateCheck = {};

        data.results.bindings.forEach(function(feature) {
            if ('error-message' in feature) {
                console.error("error in findRoomContents");
                console.error(JSON.stringify(feature));
                return;
            }

            if (feature.roomFeature.value in featureDuplicateCheck) {
                return;
            }

            room.properties.contents.push({feature: feature.roomFeature.value, subject: feature.subject.value, label: feature.label.value});

            featureDuplicateCheck[feature.roomFeature.value] = true;

            if (feature.subject.value === "http://id.southampton.ac.uk/point-of-interest-category/iSolutions-Workstations") {
                workstations[feature.roomFeature.value] = {
                    type: "Feature",
                    geometry: {
                        type: "Point",
                        coordinates: [parseFloat(room.properties.center[1], 10), parseFloat(room.properties.center[0], 10)]
                    },
                    properties: {
                        label: feature.label.value,
                        room: room.properties.uri,
                        uri: feature.roomFeature.value
                    }
                };
            }
        });

        callback();
    });
}

function findRoomFeatures(room, callback) {
    var query = "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
PREFIX oo: <http://purl.org/openorg/>\
SELECT ?feature ?label WHERE {\
    ?uri oo:hasFeature ?feature .\
    ?feature rdfs:label ?label\
    FILTER (";

    query += "?uri = <" + room.properties.uri + ">";
    query += ')}';

    sparqlQuery(query, function(err, data) {
        if (err) {
            console.error("error in findRoomFeatures");
            console.error("query " + query);
            console.error(err);
        }

        room.properties.features = [];
        data.results.bindings.forEach(function(feature) {
            if ('error-message' in feature) {
                console.error("error in findRoomFeatures");
                console.error(JSON.stringify(feature));
                console.error("query:\n" + query);
                return;
            }

            room.properties.features.push({
                feature: feature.feature.value,
                label: feature.label.value
            });
        });

        callback();
    });
}

// workstations

function getUniWorkstations(workstations, callback) {
    var query = 'PREFIX soton: <http://id.southampton.ac.uk/ns/>\
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
PREFIX dct: <http://purl.org/dc/terms/>\
PREFIX spacerel: <http://data.ordnancesurvey.co.uk/ontology/spatialrelations/>\
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
SELECT * WHERE {\
?workstation a <http://purl.org/goodrelations/v1#LocationOfSalesOrServiceProvisioning> ;\
               dct:subject <http://id.southampton.ac.uk/point-of-interest-category/iSolutions-Workstations> ;\
               rdfs:label ?label ;\
               spacerel:within ?building .\
    ?building rdf:type soton:UoSBuilding .\
}';

    sparqlQuery(query, function(err, data) {
        if (err) {
            console.error("error in getUniWorkstations");
            console.error(err);
            console.error("query " + query);
        }

        var results = data.results.bindings;

        async.each(results, function(workstation, callback) {
            var uri = workstation.workstation.value,
                label = workstation.label.value,
                building = workstation.building.value;

            if (!(uri in workstations)) {

                getBuildingCenter(building, function(err, center) {
                    if (err) {
                        console.error("error in getUniWorkstations");
                        console.error(err);
                        callback();
                        return;
                    }

                    workstations[uri] = {
                        type: "Feature",
                        geometry: center,
                        properties: {
                            label: label,
                            uri: uri
                        }
                    };

                    callback();
                });
            } else {
                callback();
            }
        }, function(err) {
            var features = Object.keys(workstations).map(function(workstation) {
                return workstations[workstation];
            });

            var workstationsFeatureCollection = { type: "FeatureCollection", features: features };

            callback(null, workstationsFeatureCollection);
        });
    });
}

// buildingFeatures

function getPrinters(buildings, callback) {
    console.info("begining create printers");

    var query = "PREFIX spacerel: <http://data.ordnancesurvey.co.uk/ontology/spatialrelations/>\
PREFIX soton: <http://id.southampton.ac.uk/ns/>\
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
PREFIX ns1: <http://vocab.deri.ie/rooms#>\
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\
SELECT * WHERE {\
    ?mdf a <http://www.productontology.org/id/Multifunction_printer> ;\
         rdfs:label ?label ;\
         <http://data.ordnancesurvey.co.uk/ontology/spatialrelations/within> ?building .\
    ?building <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> soton:UoSBuilding .\
    OPTIONAL {\
      ?mdf <http://data.ordnancesurvey.co.uk/ontology/spatialrelations/within> ?room .\
      ?room rdf:type ns1:Room\
    }\
}";

    sparqlQuery(query, function(err, data) {
        if (err) {
            console.error("error in getPrinters");
            console.error(err);
            console.error("query " + query);
        }

        var printerLabelByURI = {};

        // For validation
        var openDataPrinterURIs = {}

        async.map(data.results.bindings, function(result, callback) {
            if ('error-message' in result) {
                console.error("error in getPrinters");
                console.error(result);
                console.error("query " + query);
                callback();
                return;
            }

            var uri = result.mdf.value;

            openDataPrinterURIs[uri] = true;

            var building = result.building.value;
            if ("room" in result)
                var room = result.room.value;
            var label = result.label.value;

            printerLabelByURI[uri] = label;

            var feature = {
                type: "Feature",
                properties: {
                    label: label,
                    uri: uri
                }
            };

            if (uri in printers) {
                feature.geometry = {
                    type: "Point",
                    coordinates: printers[uri].coordinates
                };

                feature.properties.level = parseInt(printers[uri].level, 10);
            }

            if (building in buildings) {
                var buildingProperties = buildings[building].properties;

                if (!('services' in buildingProperties)) {
                    buildingProperties.services = { mfds: [] };
                } else if (!('mfds' in buildingProperties.services)) {
                    buildingProperties.services.mfds = [];
                }

                buildingProperties.services.mfds.push(uri);

                buildingProperties.services.mfds.sort(function(aURI, bURI) {
                    var textA = printerLabelByURI[aURI].toUpperCase();
                    var textB = printerLabelByURI[bURI].toUpperCase();
                    return (textA < textB) ? -1 : (textA > textB) ? 1 : 0;
                });
            } else {
                addBuildingMessage(building, "errors", "location", "unknown buildingPrinter");
            }

            callback(null, feature);
        }, function(err, results) {
            var printersWithLocations = 0;

            Object.keys(printers).forEach(function(uri) {
                if (!(uri in openDataPrinterURIs)) {
                    console.error("error printer " + uri + " is not known");
                } else {
                    printersWithLocations++;
                }
            });

            console.info("finished processing printers (" + printersWithLocations + "/" + Object.keys(openDataPrinterURIs).length + ")");

            async.filter(results,
                function(printer, callback) {
                    callback(typeof printer !== 'undefined');
                },
                function(cleanResults) {
                    callback(err, cleanResults);
                }
            );
        });
    });
}

function getVendingMachines(buildings, callback) {
    console.info("begin getVendingMachines");

    var query = "PREFIX spacerel: <http://data.ordnancesurvey.co.uk/ontology/spatialrelations/>\
PREFIX soton: <http://id.southampton.ac.uk/ns/>\
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
SELECT * WHERE {\
    ?uri a <http://purl.org/goodrelations/v1#LocationOfSalesOrServiceProvisioning> ;\
         rdfs:label ?label ;\
         soton:vendingMachineModel ?model ;\
         soton:vendingMachineType ?type ;\
         spacerel:within ?building .\
}";

    sparqlQuery(query, function(err, data) {
        if (err) {
            console.error("Query " + query);
            console.error(err);
            callback(err);
            return;
        }

        query = "select ST_AsGeoJSON(ST_Transform(way, 4326), 10) as point,osm_id,vending,level,uri from planet_osm_point where ST_Contains((select ST_Union(way) from uni_site), way) and amenity='vending_machine';"

        pg.query(query, function(err, results) {
            if (err) {
                console.error("Query: " + query);
                console.error(err);
                callback(err);
                return;
            }

            var machinesByURI = {};
            var machines = [];

            // First, look through OSM finding the location of the vending
            // machines
            results.rows.forEach(function(part) {
                var feature = { type: "Feature" };
                feature.geometry = JSON.parse(part.point);
                delete part.point;
                delete part.osm_id;

                feature.properties = part;

                machinesByURI[part.uri] = feature;

                machines.push(feature);
            });

            // Then look through the University Open Data, to find the ones OSM
            // is missing, and any additional information
            data.results.bindings.forEach(function(result) {
                var uri = result.uri.value;
                var machine;

                if (uri in machinesByURI) {
                    machine = machinesByURI[uri];

                    machine.properties.label = result.label.value;
                } else {
                    machine = { type: "Feature", properties: { uri: uri, label: result.label.value } };

                    machinesByURI[uri] = machine;

                    machines.push(machine);
                }

                var building = result.building.value;
                if (!(building in buildings)) {
                    if (building.indexOf("site") === -1) // building could actually be a site, query needs fixing
                        addBuildingMessage(building, "errors", "location", "unknown (vendingMachine)");
                } else {
                    var buildingProperties = buildings[building].properties;

                    if (!('services' in buildingProperties)) {
                        buildingProperties.services = { vendingMachines: [] };
                    } else if (!('vendingMachines' in buildingProperties.services)) {
                        buildingProperties.services.vendingMachines = [];
                    }

                    buildingProperties.services.vendingMachines.push(uri);
                }
            });

            callback(err, machines);
        });
    });
}

// busStops and busRoutes

function processRoute(route, routeMaster, stopAreaRoutes, callback) {

    var ways = [];
    var stopRefs = [];

    async.eachSeries(route.members, function(member /* either a stop_area, or a road */, callback) {
        if (member.type === "relation") { // Then its a stop_area
            // Add the stop to the list (stopAreas)
            if (member.ref in stopAreaRoutes) {
                if (stopAreaRoutes[member.ref].indexOf(route.tags.ref) < 0)
                    stopAreaRoutes[member.ref].push(route.tags.ref);
            } else {
                stopAreaRoutes[member.ref] = [route.tags.ref];
            }

            stopRefs.push(member.ref);

            callback();
        } else {
            var query = "select ST_AsGeoJSON(ST_Transform(way, 4326), 10) as way from planet_osm_line where osm_id = " + member.ref;

            pg.query(query, function(err, results) {
                if (err) callback(err);

                ways.push(JSON.parse(results.rows[0].way).coordinates);

                callback();
            });
        }
    }, function(err) {
        // Now to create the route geometry

        getRelations(stopRefs, function(err, areas) {

            var stopURIs = areas.map(function(area) {
                var uri = area.tags.uri;

                if (uri.indexOf("http://transport.data.gov.uk/id/stop-point/") === 0) {
                    uri = "http://id.southampton.ac.uk/bus-stop/" + uri.slice(43);
                } else {
                    console.warn("Unrecognised bus stop uri " + uri);
                }

                return uri;
            });

            createRouteGeometry(ways, function(err, routeCoords) {
                if (err) {
                    console.error("geometry errors for route " + route.tags.name);
                    err.forEach(function(error) {
                        console.error("    " + error);
                    });
                }

                var busRoute = {
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: routeCoords
                    },
                    properties: {
                        name: route.tags.name,
                        ref: route.tags.ref,
                        stops: stopURIs
                    }
                }

                if ('colour' in route.tags) {
                    busRoute.properties.colour = route.tags.colour;
                }

                if (routeMaster !== null) {
                    busRoute.properties.routeMaster = routeMaster.tags.ref;

                    if (!('colour' in route.tags) && 'colour' in routeMaster.tags) {
                        busRoute.properties.colour = routeMaster.tags.colour;
                    }
                }

                callback(null, busRoute);
            });
        });
    });
}

function loadBusData(collections, callback) {
    var stopAreaRoutes = {} // Mapping from id to stop area, also contains the route names for that stop area

    async.waterfall([
        function(callback) {
            var query = "select id,parts,members,tags from planet_osm_rels where tags @> array['type', 'route_master', 'Uni-link']";
            pg.query(query, callback);
        },
        function(results, callback) {
            async.map(results.rows, function(relation, callback) {
                processRelation(relation, callback);
            }, callback);
        },
        function(routeMasters, callback) {
            collections.busRoutes = {
                type: "FeatureCollection",
                features: []
            };

            async.eachSeries(routeMasters, function(routeMaster, callback) {
                async.eachSeries(routeMaster.members, function(member, callback) {

                    // Pull in the route in the route master
                    getRelation(member.ref, function(err, route) {
                        if (err) callback(err);

                        processRoute(route, routeMaster, stopAreaRoutes, function(err, feature) {
                            collections.busRoutes.features.push(feature);

                            callback(err);
                        });
                    });
                }, callback);
            }, callback);
        },
        // Now look at the individual routes that are not in route masters
        function(callback) {
            var query = "select id,parts,members,tags from planet_osm_rels where tags @> array['type', 'route', 'Uni-link']";
            pg.query(query, callback);
        },
        function(results, callback) {
            async.map(results.rows, function(relation, callback) {
                processRelation(relation, callback);
            }, callback);
        },
        function(routes, callback) {
            async.eachSeries(routes, function(route, callback) {
                processRoute(route, null, stopAreaRoutes, function(err, feature) {
                    collections.busRoutes.features.push(feature);

                    callback(err);
                });
            }, callback);
        },
        // Now the route processing has finished, the bus stops can be created
        function(callback) {
            createBusStops(stopAreaRoutes, callback);
        }
    ], function(err, busStops) {

        collections.busStops = busStops;

        // Now remove all but the longest U1C route...

        var longestRoute = 0;
        for (var i in collections.busRoutes.features) {
            var route = collections.busRoutes.features[i];

            if (route.properties.ref !== "U1C") {
                continue;
            }

            var stops = route.properties.stops.length;
            console.log(stops);
            if (stops > longestRoute) {
                longestRoute = stops;
            }
        }

        console.log("longest route " + longestRoute);

        i = collections.busRoutes.features.length;
        while (i--) {
            route = collections.busRoutes.features[i];

            if (route.properties.ref !== "U1C") {
                continue;
            }

            var stops = route.properties.stops.length;

            if (stops !== longestRoute) {
                console.log("removing " + i);

                collections.busRoutes.features.splice(i, 1);
            }
        }

        console.info("finished loadBusData");
        if (err)
           console.error(err);

        callback(err, collections);
    });
}

function createRouteGeometry(ways, callback) {
    var routeCoords = [];
    var errors = [];

    //console.log(JSON.stringify(ways.slice(2)), null, 4);

    function last(way) {
        return way.slice(-1)[0];
    }

    function first(way) {
        return way[0];
    }

    function equal(coord1, coord2) {
        return coord1[0] === coord2[0] && coord1[1] === coord2[1];
    }

    // If the first way end joins with the 2nd way start or end, leave it as is
    if (!(equal(last(ways[0]), first(ways[1])) || equal(last(ways[0]), last(ways[1])))) {
        ways[0].reverse();

        // Check if this reversed starting way works
        if (!(equal(last(ways[0]), first(ways[1])) || equal(last(ways[0]), last(ways[1])))) {
            errors.push("cannot determine correct alignment of first way");
        }
    }

    // Add a clone such that the pop in the following loop does not modify the
    // original array
    routeCoords = ways[0].slice(0);

    for (var i=1; i<ways.length; i++) {
        var way = ways[i];

        // pop the end node, as this will be present on the next way added
        routeCoords.pop();

        if (equal(last(ways[i-1]), first(way))) {
            routeCoords.push.apply(routeCoords, way);
        } else {
            if (!equal(last(ways[i-1]), last(way))) {
                errors.push("break detected at " + i + " " + last(ways[i-1]) + " " + last(way));
            }
            routeCoords.push.apply(routeCoords, way.reverse());
        }
    }

    if (errors.length === 0)
        errors = null;

    callback(errors, routeCoords);
}

function createBusStops(stopAreaRoutes, callback) {
    async.waterfall([
        function(callback) {
            pg.query('drop table if exists uni_bus_stop', function(err, results) {
                callback(err);
            });
        },
        function(callback) {
            console.info("creating uni_bus_stop");
            pg.query('create table uni_bus_stop ( way geometry, name text, uri text, routes text array);', function(err, results) {
                callback(err);
            });
        },
        function(callback) {
            getRelations(Object.keys(stopAreaRoutes), function(err, areas) {
                var featureCollection = {
                    type: "FeatureCollection",
                    features: []
                };

                async.each(areas, function(area, callback) {
                    createBusStop(area, stopAreaRoutes[area.id], function(err, busStop) {
                        if (err){
                            console.warn(err);
                        } else {
                            featureCollection.features.push(busStop);
                        }

                        callback();
                    });
                }, function(err) {
                    callback(err, featureCollection);
                });
            });
        }
    ], function(err, busStops) {
        if (err)
            console.error(err);

        console.info("finished createBusStops");

        callback(err, busStops);
    });
}

function createBusStop(stopArea, routes, callback) {
    for (var i=0; i<stopArea.members.length; i++) {
        var member = stopArea.members[i];
        if (member.role === "platform") {
            var ref =  member.ref;

            var name = stopArea.tags.name;
            if (name !== undefined) {
                name = name.replace("'", "''");
            } else {
                name = '';
            }

            var routeArray = "{" + routes.join(", ") + "}";

            var uri = stopArea.tags.uri;

            if (uri.indexOf("http://transport.data.gov.uk/id/stop-point/") === 0) {
                uri = "http://id.southampton.ac.uk/bus-stop/" + uri.slice(43);
            } else {
                console.warn("Unrecognised bus stop uri " + uri);
            }

            switch (member.type) {
                case "node":
                    getNode(ref, function(err, node) {

                        var pgQuery = "insert into uni_bus_stop values(ST_SetSRID(ST_MakePoint("
                        pgQuery = pgQuery + node.geometry.coordinates[0] + ", " + node.geometry.coordinates[1];
                        pgQuery = pgQuery + "),4326), '" + name + "', '" + uri + "', '" + routeArray + "');";

                        pg.query(pgQuery, function(err, result) {
                            if (err) {
                                console.error("Query: " + pgQuery);
                                console.error(err);
                            }

                            callback(err, {
                                type: "Feature",
                                geometry: node.geometry,
                                properties: {
                                    name: name,
                                    uri: uri,
                                    routes: routes
                                }
                            });
                        });
                    });

                    break;
                case "way":
                    var query = "select ST_AsGeoJSON(ST_Transform(way, 4326), 10) as way from planet_osm_polygon where osm_id = " + member.ref;

                    pg.query(query, function(err, results) {
                        if (err) {
                            console.error("Query: " + pgQuery);
                            callback(err);
                            return;
                        }

                        var feature = {
                            type: "Feature",
                            geometry: JSON.parse(results.rows[0].way),
                            properties: {
                                name: name,
                                uri: uri,
                                routes: routes
                            }
                        }

                        callback(err, feature);
                    });

                    break;
            }
            // Found the platform, so
            break;
        }
    }

    if (ref === undefined) {
        callback("no platform for area " + stopArea.tags.name + " (" + stopArea.id + ")");
        return;
    }
}

// Utility Functions

function decomposeRoomURI(uri) {
    var parts = uri.split("/").slice(-1)[0].split("-");

    if (parts.length !== 2) {
        console.warn("cannot parse " + uri);
        return undefined;
    }

    var level = parts[1].slice(0, parts[1].length - 3);

    return { building: parts[0], room: parts[1], level: level };
}

function processRelation(relation, callback) {
    var obj = { tags: {}, members: []};

    for (var i=0; i<relation.members.length; i+=2) {
        var type = relation.members[i].charAt(0);
        var ref = parseInt(relation.members[i].slice(1), 10);
        if (type === "r")
            type = "relation";
        else if (type === "w")
            type = "way";
        else if (type === "n")
            type = "node";
        else
            console.warn("Unknown type " + type);
        obj.members.push({ type: type, ref: ref, role: relation.members[i+1] });
    }

    for (var i=0; i<relation.tags.length; i+=2) {
        obj.tags[relation.tags[i]] = relation.tags[i+1];
    }

    obj.id = parseInt(relation.id, 10);

    // This seems to make things right, unsure why?
    obj.members.reverse();

    callback(null, obj);
}

function getRelations(ids, callback) {
    if (ids.length === 0) {
        console.error("cant get 0 relations");
        callback("cant get 0 relations");
        return;
    }

    var query = "select id,parts,members,tags from planet_osm_rels where id in (";

    query += ids.join() + ")";

    pg.query(query, function(err, results) {
        if (err) {
            console.error(err);
            console.error(query);
            callback(err);
            return;
        }

        async.map(results.rows, function(relation, callback) {
           processRelation(relation, callback);
        }, function(err, relations) {

            var relsByID = {};

            relations.forEach(function(relation) {
                relsByID[relation.id] = relation;
            });

            var orderedRelations = ids.map(function(id) {
                return relsByID[id];
            });

            callback(null, orderedRelations);
        });
    });
}

function getBuildingCenter(uri, callback) {

    var hardcodedBuildings = {
        "http://id.southampton.ac.uk/building/9591": {
            type: "Point",
            coordinates: [-1.10957, 51.28056]
        },
        "http://id.southampton.ac.uk/building/9594": {
            type: "Point",
            coordinates: [-1.30083, 50.71109]
        }
    }

    if (uri in hardcodedBuildings) {
        callback(null, hardcodedBuildings[uri]);
        return;
    }

    var query = "select ST_AsGeoJSON(ST_Centroid(ST_Transform(way, 4326)), 10) as center from uni_building where uri='" + uri + "';";

    pg.query(query, function(err, results) {
        if (err) {
            console.error(err);
            console.error(query);
            callback(err);
            return;
        }

        if (results.rows.length === 0) {
            callback("building not found " + uri);
        } else {
            callback(err, JSON.parse(results.rows[0].center));
        }
    });
}

function getRelation(id, callback) {
    var query = "select id,parts,members,tags from planet_osm_rels where id = " + id;

    pg.query(query, function(err, results) {
        if (err) {
            console.error("Query: " + query);
            console.error(err);
            callback(err);
            return;
        }

        processRelation(results.rows[0], callback);
    });
}

function getNode(id, callback) {
    var query = "select *, ST_AsGeoJSON(ST_Transform(way, 4326)) as point from planet_osm_point where osm_id = " + id;

    pg.query(query, function(err, results) {
        if (err) {
            console.error("Query: " + query);
            console.error(err);
            callback(err);
            return;
        }

        var row = results.rows[0];

        var node = { id: row.osm_id, geometry: JSON.parse(row.point), properties: {} };

        delete row.point;
        delete row.osm_id;
        delete row.way;

        for (var tag in row) {
            var value = row[tag];
            if (value !== null) {
                node.properties[tag] = value;
            }
        }

        callback(err, node);
    });
}

function sparqlQuery(query, callback) {
    http.get("http://sparql.data.southampton.ac.uk/?query=" + encodeURIComponent(query) + "&output=json", function(res) {
        var data = '';

        res.on('data', function (chunk){
            data += chunk;
        });

        res.on('end',function(){
            if (res.statusCode !== 200)
                callback(data);

            var obj = JSON.parse(data);

            callback(null, obj);
        })
    }).on('error', function(e) {
        console.error("SPARQL error: " + e.message);
        callback(e);
    });
}

function getImagesFor(uri, callback) {

    var imageQuery = 'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\
PREFIX soton: <http://id.southampton.ac.uk/ns/>\
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\
PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>\
PREFIX dcterms: <http://purl.org/dc/terms/>\
SELECT * WHERE {\
GRAPH <http://id.southampton.ac.uk/dataset/photos/latest> {\
?image a foaf:Image ;\
foaf:depicts <{{uri}}> ;\
nfo:width ?width ;\
nfo:height ?height .\
OPTIONAL { ?image dcterms:creator ?creator ; } .\
OPTIONAL { ?image dcterms:license ?license ; }\
}\
}'

    imageQuery = imageQuery.template({uri: uri});

    sparqlQuery(imageQuery, function(err, data) {
        if (err) {
            console.error("error in getImagesFor");
            console.error(err);
            callback(err);
            return;
        }

        var imageGroups = {};

        async.each(data.results.bindings, function(image, callback) {
            if ('error-message' in image) {
                console.error("error in getImagesFor");
                console.error(JSON.stringify(image));
                console.error("query: \n" + imageQuery);
                callback(image);
                return;
            }

            var obj = {};
            obj.url = image.image.value;
            obj.width = image.width.value;
            obj.height = image.height.value;


            var imageName = obj.url.split("/").slice(-1)[0];

            if (imageName in imageGroups) {
                imageGroups[imageName].versions.push(obj);
            } else {
                imageGroups[imageName] = { versions: [obj] };
                if ('licence' in image) {
                    imageGroups[imageName].license = image.license.value;
                }
                if ('creator' in image) {
                    imageGroups[imageName].creator = image.creator.value;
                }
            }

            callback(null, obj);
        }, function(err) {
            if (err) {
                callback(err);
                return;
            }

            var images = [];

            for (var key in imageGroups) {
                var ig = imageGroups[key];

                ig.versions.sort(function(v1, v2) {
                    return (v2.width * v2.height) - (v1.width * v1.height);
                });

                images.push(ig);
            }

            callback(err, images);
        });
    });
}

// Output Functions

function writeDataFiles(data, callback) {
    async.parallel([
        function(callback) {
            var stream = fs.createWriteStream("./data.json");
            stream.once('open', function(fd) {
                stream.write(JSON.stringify(data));
                stream.end();
                callback();
            });
        },
        function(callback) {
            var stream = fs.createWriteStream("./data-source.json");
            stream.once('open', function(fd) {
                stream.write(JSON.stringify(data, null, 4));
                stream.end();
                callback();
            });
        }
    ], callback);
}

// Validation Functions

function validateBuildingParts(buildingParts, callback) {
    console.info("begining validating buildingparts");

    async.each(Object.keys(uniRooms), function(room, callback) {
        var type = uniRooms[room].type;
        var building = uniRooms[room].building;

        if (room in buildingRooms) {

        } else {
            var roomNeeded = 'Room <a href="' + room + '">' + room + '</a> is missing';

            addBuildingToDo(building, 'rooms', roomNeeded);
        }

        callback();
    }, callback);
}

function validateBuildings(callback) {
    var query = "PREFIX soton: <http://id.southampton.ac.uk/ns/>\
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>\
SELECT * WHERE {\
    ?building <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> soton:UoSBuilding ;\
              skos:notation ?ref\
}";

    sparqlQuery(query, function(err, data) {
        if (err) {
            console.error("Query " + query);
            console.error(err);
        }

        async.each(data.results.bindings, function(building, callback) {
            var uri = building.building.value;

            if (!(uri in buildings)) {
                addBuildingMessage(uri, "errors", "location", "unknown (validateBuildings)");
            }

            callback();
        }, function(err) {
            console.info("finished validateBuildings");
            callback(err);
        });
    });
}

function addBuildingMessage(buildingURI, severity, section, message) {
    var buildingValidation;

    if (buildingURI in validationByURI) {
        buildingValidation = validationByURI[buildingURI];
    } else {
        buildingValidation = {todo: {}, warnings: {}, errors: {}};
        validationByURI[buildingURI] = buildingValidation;
    }

    if (!(section in buildingValidation[severity])) {
        buildingValidation[severity][section] = [];
    }

    buildingValidation[severity][section].push(message);
}

function addRoomMessage(roomURI, severity, section, message) {
    var roomValidation;

    if (roomURI in validationByURI) {
        roomValidation = validationByURI[roomURI];
    } else {
        roomValidation = {todo: {}, warnings: {}, errors: {}};
        validationByURI[roomURI] = roomValidation;
    }

    if (!(section in roomValidation[severity])) {
        roomValidation[severity][section] = [];
    }

    roomValidation[severity][section].push(message);
}
