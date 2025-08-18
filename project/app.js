

import { GestureRecognizer, FilesetResolver } from "https://unpkg.com/@mediapipe/tasks-vision@latest?module";

/*
thumb up: forward, 
thumb down: back, 
go left: ILoveYou, 
go right: Victory, 
go forward until: pointing up, 
shut down: closed fist, 
start: open palm.
*/

var map = null;
var droneMarker = null;
var START = {lat: 33.205975, lng: 35.568292};
var BASE_ICON = null;
var drone = {lat: 33.205975, lng: 35.568292, heading: 0, speed: 70};
var enabled = true; //true after open-palm
var forwardTimer = null; //for auto forward (pointing up)
var lastActionAt = 0; //cooldown timestamp
var COOLDOWN_MS = 400;

window.initMap = function() {
    //create a new map and show it in the map div
    BASE_ICON = {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 5,
        strokeWeight: 1,
        rotation: 0,
        strokeColor: "#FF6666",
        fillColor: "#CC0000",
        fillOpacity: 1,
    };

    map = new google.maps.Map(document.getElementById("map"), {
        center: START,
        zoom: 12,
    });
    
    droneMarker = new google.maps.Marker({
        position: START,
        map,
        title: "My Drone",
        icon: Object.assign({}, BASE_ICON, {rotation: drone.heading})
    });
};

//helper functions
function updateMarker() {
    if (!droneMarker || !map) return;

    droneMarker.setPosition({lat: drone.lat, lng: drone.lng});

    //rotate to new heading
    var icon =  Object.assign({}, BASE_ICON, {rotation: drone.heading});
    droneMarker.setIcon(icon);

    //keep map centered
    map.panTo({lat: drone.lat, lng: drone.lng});
    
}

function moveForward(mult = 1) {
    var meters = drone.speed * mult;
    var from = new google.maps.LatLng(drone.lat, drone.lng);
    var to = google.maps.geometry.spherical.computeOffset(from, meters, drone.heading);

    drone.lat = to.lat();
    drone.lng = to.lng();

    updateMarker();
}

function moveBackward() {moveForward(-1);}
function turnLeft() {
    drone.heading = (drone.heading - 10 + 360) % 360;
    updateMarker();
}
function turnRight() {
    drone.heading = (drone.heading + 10 + 360) % 360;
    updateMarker();
}

//camera
var stream = null;
const constraints = {
    video: true,
}

async function startCam() {
    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);

        const video = document.getElementById('cam');
        video.srcObject = stream;
        await video.play();

        const button = document.getElementById('startCam');
        button.textContent = 'camera on';
        button.disabled = true;

        //load model
        if(!recognizer) recognizer = await loadRecognizer();
        startGestureLoop();
    }
    catch(err) {
        alert('camera error: ' + err.name);
        console.error(err);
    }
}

document.getElementById('startCam').addEventListener('click', startCam);

//mediaPipe
let recognizer = null;

async function loadRecognizer() {
    const files = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );
    const rec = await GestureRecognizer.createFromModelPath(files,
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float32/latest/gesture_recognizer.task"
    );  
    
    await rec.setOptions({runningMode: "VIDEO", numHands: 1});
    console.log("gesture model loaded");
    return rec;
}

function startGestureLoop() {
    const video = document.getElementById("cam");

    function loop() {
        if (recognizer && video.readyState >= 2) {
            //if hand gesture has been recognized and video is ready
            const res = recognizer.recognizeForVideo(video, performance.now());

            if (res && res.gestures && res.gestures.length > 0) {
                const firstHand = res.gestures[0];
                if(firstHand && firstHand.length > 0) {
                    const top = firstHand[0];
                    handleGesture(top.categoryName);
                    console.log("gesture: ", top.categoryName)
                }
            }
        }
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}

//map gestures
function handleGesture(name) {

    /*
    thumb up: forward, 
    thumb down: back, 
    go left: ILoveYou, 
    go right: Victory, 
    go forward until: pointing up, 
    shut down: closed fist, 
    start: open palm.
    */

    var now = performance.now();

    //start/stop
    if (name === "Open_Palm") {
        enabled = true;
        return;
    }

    if (name === "Closed_Fist") {
        enabled = false;
        if (forwardTimer) {
            clearInterval(forwardTimer);
            forwardTimer = null;
        }
    }

    if(!enabled) return; //if controls are off - ignore everything

    //auto-forward
    if (name === "Pointing_Up") {
        if (!forwardTimer) {
            forwardTimer = setInterval(function() {
                moveForward(1);
            }, 120);
        }
        return;
    } else if (forwardTimer) {
        //stop aute movment when new gesture appear
        clearInterval(forwardTimer);
        forwardTimer = null;
    }


    if (now - lastActionAt < COOLDOWN_MS) return;
    
    if (name === "Thumb_Up") {moveForward(1); lastActionAt = now;}
    if (name === "Thumb_Down") {moveBackward(); lastActionAt = now;}
    if (name === "ILoveYou") {turnLeft(); lastActionAt = now;}
    if (name === "Victory") {turnRight(); lastActionAt = now;}
}


