/* Magic Mirror Module: MMM-TracCar
 * v1.0.1 - May 2018
 *
 * By Asim Siddiqui <asimhsidd@gmail.com>
 * MIT License
 */

Module.register("MMM-TracCar", {
	defaults: {
		map_width: 300,
		map_zoom: 15,
		map_height: 400,
		map_border_radius: 10,
		map_shadow_color: "white",
		mapSTYLE: // from https://snazzymaps.com
			[
				{
					"featureType": "all",
					"stylers": [
						{
							"saturation": 0
						},
						{
							"hue": "#e7ecf0"
						}
					]
				},
				{
					"featureType": "road",
					"stylers": [
						{
							"saturation": -70
						}
					]
				},
				{
					"featureType": "transit",
					"stylers": [
						{
							"visibility": "off"
						}
					]
				},
				{
					"featureType": "poi",
					"stylers": [
						{
							"visibility": "off"
						}
					]
				},
				{
					"featureType": "water",
					"stylers": [
						{
							"visibility": "simplified"
						},
						{
							"saturation": -60
						}
					]
				}
			]
	},

	start: function () {
		self = this;
		self.loaded = false;
		self.plotted = false;
		var el = document.createElement('script');
		el.src = "//maps.googleapis.com/maps/api/js?key=" + self.config.gmapid;
		el.onload = function () {
			self.sendSocketNotification("INITIATEDEVICES", self.config);
			console.log("MMM-TracCar: Google API loaded!");
		};
		document.querySelector("body").append(el);
	},

	getDom: function () {
		var self = this;
		var wrapper = document.createElement("div");
		wrapper.id = self.identifier + "_wrapper";
		if (!self.loaded) {
			wrapper.innerHTML = this.translate("MMM-TracCar is Loading.");
			wrapper.className = "dimmed light small";
			return wrapper;
		}
		// map div creation
		var mapElement = document.createElement("div");
		self.mapId = self.identifier + "_gmap";
		mapElement.id = self.mapId;
		var style = "width:" + self.config.map_width + "px; height:" + self.config.map_height + "px; -webkit-border-radius:" + self.config.map_border_radius + "px; -moz-border-radius:" + self.config.map_border_radius + "px; border-radius:" + self.config.map_border_radius + "px; -webkit-box-shadow:0px 0px 117px -6px " + self.config.map_shadow_color + "; -moz-box-shadow:0px 0px 117px -6px " + self.config.map_shadow_color + "; box-shadow:0px 0px 117px -6px " + self.config.map_shadow_color + ";";
		mapElement.style = style;
		wrapper.appendChild(mapElement);
		return wrapper;
	},

	socketNotificationReceived: function (notification, payload) {
		var self = this;
		switch (notification) {
			case "Devices":
				console.log("MMM-TracCar: Devices found!");
				self.users = {};
				var devices = JSON.parse(payload);
				Object.keys(devices).forEach(function (key) {
					self.users[devices[key].id] =
					{
						name: devices[key].name,
						lastupd: devices[key].lastUpdate,
						sts: devices[key].status,
						position: null // Will be kept up to date with last known position
					}
				});
				self.sendSocketNotification("SETUP", self.config);
				break;
			case "Position":
				var positions = JSON.parse(payload).positions;
				if (positions == null && typeof positions !== 'object') { break; }
				self.updateUserPositions(positions);
				if (!self.plotted) { // Create the map, create the markers
					console.log("MMM-TracCar: Connections made, setting up the map & markers!");
					self.map = "";
					self.clusters = [];
					self.loaded = true;
					self.updateDom(500);
					setTimeout(function () { // In order for the dom to get updated first
						self.map = new google.maps.Map(
							document.getElementById(self.mapId),
							{
								center: { lat: 52, lng: 4.7 },
								zoom: self.config.map_zoom,
								disableDefaultUI: true,
								styles: self.config.mapSTYLE,
								maxZoom: self.config.map_zoom,
							}
						);
						self.redrawClusters();
						self.plotted = true;
					}, 1000);
				} else { // Just reposition the markers
					self.redrawClusters();
				}
				break;
			case "Error":
				// All error handling
				var wrapper = document.getElementById(self.identifier + "_wrapper");
				var k = 15;
				var loader = setInterval(function () {
					wrapper.innerHTML = "Could not connect to <b>Traccar.org</b> server.<br/>Will retry reconnecting in " + k + " seconds.";
					k--;
				}, 1000);
				setTimeout(function () {
					clearInterval(loader);
					self.sendSocketNotification("INITIATEDEVICES", self.config);
					wrapper.innerHTML = "MMM-TracCar is Loading.";
				}, k * 1000);
				break;
		}

	},

	createBoundsForMarkers: function (markers) {
		var bounds = new google.maps.LatLngBounds();
		Object.keys(markers).forEach(function (key) {
			bounds.extend(markers[key].getPosition());
		});
		return bounds;
	},

	createBoundsForClusters: function (clusters) {
		var bounds = new google.maps.LatLngBounds();
		clusters.forEach(function (cluster) {
			bounds.extend(cluster.marker.getPosition())
		});
		return bounds;
	},

	getEpsilon: function (zoom) {
		return 0.0662505 - 0.00428175 * zoom;
	},

	findCluster: function (position, clusters) {
		var epsilon = self.getEpsilon(self.map.getZoom());
		return clusters.findIndex(function (elem) {
			var lat = elem.marker.getPosition().lat();
			var lng = elem.marker.getPosition().lng();
			var distance = Math.sqrt(Math.pow(lat - position.latitude, 2) + Math.pow(lng - position.longitude, 2));
			return (distance < epsilon);
		});
	},

	redrawClusters: function () {
		var positions = [];
		Object.keys(self.users).forEach(function (key) {
			var pos = self.users[key].position;
			if (pos !== null) {
				positions.push(pos);
			}
		});

		// Remove old clusters, if any
		self.clusters.forEach(function (cluster) {
			cluster.infoWindow.close();
			cluster.marker.setMap(null);
		});

		// Map positions to clusters with a marker
		self.clusters = [];
		Object.keys(positions).forEach(function (key) {
			var name = self.users[positions[key].deviceId].name;
			var clusterInd = self.findCluster(positions[key], self.clusters);
			if (clusterInd !== -1) {
				self.clusters[clusterInd].name += "<br>" + name;
			} else {
				self.clusters.push({
					name: name,
					marker: new google.maps.Marker({
						position: new google.maps.LatLng(positions[key].latitude, positions[key].longitude), map: self.map
					}),
				});
			}
		});

		// Create infoWindows
		self.clusters.forEach(function (cluster) {
			cluster.infoWindow = new google.maps.InfoWindow({
				content: cluster.name,
				disableAutoPan: true
			});
			cluster.infoWindow.open(self.map, cluster.marker);
		});

		// Refit bounds
		self.bounds = self.createBoundsForClusters(self.clusters);
		self.map.fitBounds(self.bounds);
		self.map.panToBounds(self.bounds);
	},

	updateUserPositions: function (positions) {
		positions.forEach(function (position) {
			self.users[position.deviceId].position = position;
		});
	}

});
