

import { GestureRecognizer, FilesetResolver } from "https://unpkg.com/@mediapipe/tasks-vision@latest?module";

/*
gesture labels produced by MediaPipe:
- thumb up: forward, 
- thumb down: back, 
- go left: ILoveYou, 
- go right: Victory, 
- go forward until: pointing up, 
- shut down: closed fist, 
- start: open palm.

** new gesture **
- reset (fly to START): Shaka
*/

var map = null;
var droneMarker = null;
var START = { lat: 33.205975, lng: 35.568292 };
var SPEED = 70; // a global variable to change speed of drone
var drone = { lat: 33.205975, lng: 35.568292, heading: 0, speed: SPEED };

var enabled = true; // true after open-palm
var forwardTimer = null; // for auto forward (pointing up)
var flyHomeTimer = null; // for Shaka fly-home
var lastActionAt = 0; // cooldown timestamp
var COOLDOWN_MS = 400;

// drone image
const DRONE_SIZE = 56; // pixels on map
const DRONE_IMG = new Image();
DRONE_IMG.src = "drone.png";

// offscreen canvas for performance
const _canvas = document.createElement("canvas");
const _ctx = _canvas.getContext("2d");

function getIcon(angleDeg) {
    //return a google maps icon object
    if(DRONE_IMG.complete && DRONE_IMG.naturalWidth > 0) {
        
        //canvas set-up
        const size = DRONE_SIZE;
        _canvas.width = size;
        _canvas.height = size;
        _ctx.clearRect(0, 0, size, size);

        //rotate around the center
        _ctx.save();
        _ctx.translate(size/2, size/2);
        _ctx.rotate(angleDeg * Math.PI / 180); //deg to rad
        _ctx.imageSmoothingEnabled = true;

        //scale to fit the whole image
        const scale = Math.min(size / DRONE_IMG.naturalWidth, size / DRONE_IMG.naturalHeight);
        const drawW = DRONE_IMG.naturalWidth * scale;
        const drawH = DRONE_IMG.naturalHeight * scale;

        //draw the image centered
        _ctx.drawImage(DRONE_IMG, -drawW/2, -drawH/2, drawW, drawH);
        _ctx.restore(); //undo translate/rotate

        return {
            url: _canvas.toDataURL(),
            scaledSize: new google.maps.Size(size, size),
            anchor: new google.maps.Point(size / 2, size / 2) // rotate around center
        };
    }

    return {
        //if the icon doesnt load, load the red arrow icon
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 5,
        strokeWeight: 1,
        rotation: angleDeg,
        strokeColor: "#FF6666",
        fillColor: "#CC0000",
        fillOpacity: 1,
    };
}

window.initMap = function() {
    //create a new map and show it in the map div
    map = new google.maps.Map(document.getElementById("map"), {
        center: START,
        zoom: 12,
    });
    
    droneMarker = new google.maps.Marker({
        position: START,
        map,
        title: "My Drone",
        icon: getIcon(drone.heading)
    });
    //if the image loads after the marker is created, refresh the icon
    DRONE_IMG.addEventListener("load", updateMarker);
};


// -- custom gesture -- //

//non-thumb finger is up
function isFingerUp(landmarks, tipIdx, pipIdx) {
    //checks if tip.y is above pip.y (smaller y = higher in image coords)
    return landmarks[tipIdx]?.y < landmarks[pipIdx]?.y;
}

//thumb extended sidways
function isThumbUp(landmarks, handedness) {
    const tip = landmarks[4], ip = landmarks[3]; //thumb tip and thumb ip (the joint of the thumb before the tip)
    if (!tip || !ip) return false; 
    const hand = (handedness || "").toUpperCase(); 
    if (hand.includes("RIGHT")) return tip.x < ip.x;
    if (hand.includes("LEFT")) return tip.x > ip.x;

    //if we dont know the handedness - check if the tip is at least a bit sidways from the joint
    return (Math.abs(tip.x - ip.x) > 0.02);
}

//"shaka": thumb and pinky up, the rest down
function isShaka(landmarks, handedness) {
    if (!landmarks || landmarks.length < 21) return false;
    const thumbUp = isThumbUp(landmarks, handedness);
    const pinkyUp = isFingerUp(landmarks, 20, 18); //pinky tip and pinky pip
    
    //check if the rest of the fingers are are down 
    const indexDown = !isFingerUp(landmarks, 8, 6);
    const middleDown = !isFingerUp(landmarks, 12, 10);
    const ringDown = !isFingerUp(landmarks, 16, 14);

    return thumbUp && pinkyUp && indexDown && middleDown && ringDown;
}

// -- movement helper -- // 

function updateMarker() {
    if (!droneMarker || !map) return;

    droneMarker.setPosition({lat: drone.lat, lng: drone.lng});

    //use the rotated image
    droneMarker.setIcon(getIcon(drone.heading));

    //keep map centered
    map.panTo({lat: drone.lat, lng: drone.lng});
    
}

//move forward/backward "meters" along current heading
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
    drone.heading = (drone.heading - 5 + 360) % 360; //heading = drone direction
    updateMarker();
}
function turnRight() {
    drone.heading = (drone.heading + 5 + 360) % 360;
    updateMarker();
}

//camera
var stream = null;
const constraints = {
    // EDIT here to change camera capture size (width, height)
    video: true,
}

//stop any running timer
function stopAllTimers() {
    if (forwardTimer) {
        clearInterval(forwardTimer);
        forwardTimer = null
    }
    if (flyHomeTimer) {
        clearInterval(flyHomeTimer);
        flyHomeTimer = null;
    }
}

//smoothly fly back to START
function returnHome() {
    stopAllTimers(); //cancel any active timers
    const TICK_MS = 120; //match auto-forward cadence

    //start a new inerval - every 120 ms, the drone "steps" towards home
    flyHomeTimer = setInterval(function() {
        const from = new google.maps.LatLng(drone.lat, drone.lng);
        const to = new google.maps.LatLng(START.lat, START.lng);

        const dist = google.maps.geometry.spherical.computeDistanceBetween(from, to); //get a straight line distance in meters
        
        if (dist < Math.max(drone.speed * 0.5, 2)) {
            //if we're close to HOME - set the drone to START
            drone.lat = START.lat;
            drone.lng = START.lng;
            drone.heading = 0;
            updateMarker();
            clearInterval(flyHomeTimer);
            flyHomeTimer = null;
            return;
        }

        //else (we're far from home): point toward START and move a step
        const bearing = google.maps.geometry.spherical.computeHeading(from, to); //calc which direction the drone needs to face
        drone.heading = (bearing + 360) % 360; 

        //choose step so we don’t overshoot on last tick
        const stepMult = Math.min(1, dist / drone.speed); // moveForward uses (drone.speed * mult)
        moveForward(stepMult);
    }, TICK_MS);
}

// -- camera -- //

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
        console.log(`${err.name}: ${err.message}`);
    }
}

document.getElementById('startCam').addEventListener('click', startCam);

// -- mediaPipe --  //

let recognizer = null;

async function loadRecognizer() {
    const files = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );
    const rec = await GestureRecognizer.createFromModelPath(files,
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task"
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
            
            //try the custom gesture
            const handed = res?.handednesses?.[0]?.[0]?.categoryName || "";
            const lms = res?.landmarks?.[0];

            if (lms && isShaka(lms, handed)) {
                handleGesture("Shaka");
                console.log("gesture: Shaka");
            } else if (res && res.gestures && res.gestures.length > 0) {
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

    ** new gesture **
    reset: shaka.
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

    //new gesture: reset to START when shaka is detected
    if (name === "Shaka") {
        if (!flyHomeTimer) {
            returnHome();
            lastActionAt = now;
        }
        return;
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
