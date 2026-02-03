import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- GERENCIAMENTO DE UI & SOCKET ---
const socket = io();
let currentRoomId = null;

// Elementos DOM
const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameUI = document.getElementById('game-ui');
const authMsg = document.getElementById('auth-msg');

// Eventos de Login
document.getElementById('btn-login').onclick = () => {
    socket.emit('login', { user: document.getElementById('username').value, pass: document.getElementById('password').value });
};
document.getElementById('btn-register').onclick = () => {
    socket.emit('register', { user: document.getElementById('username').value, pass: document.getElementById('password').value });
};

socket.on('authError', (msg) => { authMsg.innerText = msg; });
socket.on('authSuccess', (user) => {
    loginScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    socket.emit('refreshRooms');
});

// Eventos de Lobby
document.getElementById('btn-create-room').onclick = () => {
    socket.emit('createRoom', document.getElementById('new-room-name').value);
};

socket.on('roomList', (rooms) => {
    const list = document.getElementById('room-list');
    list.innerHTML = '';
    rooms.forEach(r => {
        const div = document.createElement('div');
        div.className = 'room-item';
        div.innerHTML = `<span>${r.id}</span> <span>${r.count} Players</span>`;
        div.onclick = () => socket.emit('joinRoom', r.id);
        list.appendChild(div);
    });
});

socket.on('joinSuccess', (data) => {
    // Entra no jogo!
    currentRoomId = data.roomId;
    lobbyScreen.classList.add('hidden');
    gameUI.classList.remove('hidden');
    
    // Solicita Fullscreen
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});

    // Inicia o mundo 3D
    initWorld(data.initialPos, data.players);
});

// --- LÓGICA DO JOGO (ENGINE) ---

// Nipple.js
const script = document.createElement('script');
script.src = "https://cdnjs.cloudflare.com/ajax/libs/nipplejs/0.10.1/nipplejs.min.js";
script.onload = () => { /* Ready */ };
document.head.appendChild(script);

// Controles
let jumpPressed = false;
document.getElementById('jump-btn').addEventListener('touchstart', (e) => { e.preventDefault(); jumpPressed = true; });

// Three.js Vars
let scene, camera, renderer, localPlayerMesh;
const remotePlayers = {};
const gltfLoader = new GLTFLoader();

// Física & Gameplay Vars
const MAP_HALF_SIZE = 250; // O plano tem 500, então vai de -250 a 250
const physics = {
    velocity_y: 0,
    gravity: 0.02,
    jumpForce: 0.5,
    speed: 0.4,
    inVoid: false
};

// Câmera Config (Over the Shoulder)
const cameraState = {
    yaw: 0,
    pitch: 0.1, // Começa mais horizontal
    dist: 4,    // Mais perto (antes era 8)
    shoulderOffset: 1.5 // Desvio para a direita (Over the shoulder)
};

const inputs = { forward: 0, turn: 0 };
let touchStart = { x: 0, y: 0 };
let isCameraTouch = false;

function initWorld(initialPos, existingPlayers) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 10, 150);

    // Câmera (FOV menor para parecer mais 'cinemático' como shooters)
    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);
    
    // Luzes
    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(50, 100, 50);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048); // Sombras melhores
    scene.add(dir);

    // Chão (Ground)
    const txt = new THREE.TextureLoader().load('./assets/txt.png');
    txt.wrapS = THREE.RepeatWrapping; txt.wrapT = THREE.RepeatWrapping;
    txt.repeat.set(50, 50);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ map: txt }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Jogadores Existentes
    Object.keys(existingPlayers).forEach(id => {
        if (id !== socket.id) addRemotePlayer(id, existingPlayers[id]);
    });

    // Jogador Local
    createLocalPlayer(initialPos);
    initJoystick();
    animate();
}

function createLocalPlayer(pos) {
    gltfLoader.load('./assets/player.glb', (gltf) => {
        localPlayerMesh = gltf.scene;
        localPlayerMesh.position.set(pos.x, pos.y, pos.z);
        localPlayerMesh.rotation.y = pos.rotation;
        localPlayerMesh.traverse(c => { if(c.isMesh) c.castShadow = true; });
        scene.add(localPlayerMesh);
    });
}

// --- FÍSICA E CÂMERA AVANÇADA ---

function updatePhysics() {
    if (!localPlayerMesh) return;
    const pos = localPlayerMesh.position;

    // 1. Checar se está dentro do Mapa (Void Logic)
    // O mapa vai de -250 a 250 no X e Z
    const onGround = (pos.x > -MAP_HALF_SIZE && pos.x < MAP_HALF_SIZE && pos.z > -MAP_HALF_SIZE && pos.z < MAP_HALF_SIZE);

    // Aplica Gravidade
    physics.velocity_y -= physics.gravity;
    pos.y += physics.velocity_y;

    if (onGround) {
        // Colisão com chão
        if (pos.y <= 0) {
            pos.y = 0;
            physics.velocity_y = 0;
            // Pulo
            if (jumpPressed) {
                physics.velocity_y = physics.jumpForce;
                jumpPressed = false;
            }
        }
    } else {
        // Está no Void - cai para sempre
        physics.inVoid = true;
        // Reset se cair muito (opcional)
        if (pos.y < -50) {
            pos.y = 20; pos.x = 0; pos.z = 0;
            physics.velocity_y = 0;
        }
    }
}

function updateCameraAndMovement() {
    if (!localPlayerMesh) return;

    // --- POSICIONAMENTO OVER THE SHOULDER ---
    // 1. Calcular posição esférica baseada no PITCH e YAW em torno do pivô (Personagem)
    // Mas NÃO movemos a câmera ainda.
    
    // Distância horizontal e vertical
    const hDist = cameraState.dist * Math.cos(cameraState.pitch);
    const vDist = cameraState.dist * Math.sin(cameraState.pitch);

    // Offsets baseados na rotação da câmera
    const offsetX = hDist * Math.sin(cameraState.yaw);
    const offsetZ = hDist * Math.cos(cameraState.yaw);

    // Posição ideal da câmera (CENTRALIZADA)
    const targetX = localPlayerMesh.position.x + offsetX;
    const targetZ = localPlayerMesh.position.z + offsetZ;
    const targetY = localPlayerMesh.position.y + vDist + 1.5; // +1.5 altura da cabeça

    camera.position.set(targetX, targetY, targetZ);
    
    // Câmera olha para o jogador (com leve ajuste vertical pra mira)
    camera.lookAt(localPlayerMesh.position.x, localPlayerMesh.position.y + 1.5, localPlayerMesh.position.z);

    // --- TRUQUE DO OMBRO (Deslizar para a direita) ---
    // Move a câmera localmente no eixo X dela mesma.
    // Como ela já está olhando pro player, X positivo é direita.
    camera.translateX(cameraState.shoulderOffset);

    // --- MOVIMENTO DO PERSONAGEM ---
    let moved = false;
    if (inputs.forward !== 0 || inputs.turn !== 0) {
        // O "Frente" agora depende de onde a câmera está olhando no plano horizontal
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        const theta = Math.atan2(camDir.x, camDir.z); // Ângulo Y global da câmera

        // Inputs
        const moveX = inputs.turn * Math.cos(theta) + inputs.forward * Math.sin(theta);
        const moveZ = -inputs.turn * Math.sin(theta) + inputs.forward * Math.cos(theta);

        localPlayerMesh.position.x += moveX * physics.speed;
        localPlayerMesh.position.z += moveZ * physics.speed;

        // Girar o personagem para a direção do movimento
        localPlayerMesh.rotation.y = Math.atan2(moveX, moveZ);
        moved = true;
    }

    if (moved || Math.abs(physics.velocity_y) > 0) {
        socket.emit('playerMove', {
            x: localPlayerMesh.position.x,
            y: localPlayerMesh.position.y,
            z: localPlayerMesh.position.z,
            rotation: localPlayerMesh.rotation.y
        });
    }
}

// --- INPUTS & SOCKETS ---
function initJoystick() {
    const manager = nipplejs.create({
        zone: document.getElementById('joystick-zone'),
        mode: 'static', position: { left: '50%', top: '50%' }, color: 'white'
    });
    manager.on('move', (evt, data) => {
        if (data && data.vector) { inputs.forward = data.vector.y; inputs.turn = data.vector.x; }
    });
    manager.on('end', () => { inputs.forward = 0; inputs.turn = 0; });
}

// Touch Câmera
document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t.target.closest('#joystick-zone') || t.target.closest('.action-btn')) return;
    touchStart.x = t.clientX; touchStart.y = t.clientY; isCameraTouch = true;
}, { passive: false });

document.addEventListener('touchmove', (e) => {
    if (!isCameraTouch) return;
    const t = e.touches[0];
    const deltaX = t.clientX - touchStart.x;
    const deltaY = t.clientY - touchStart.y;
    
    cameraState.yaw -= deltaX * 0.005;
    cameraState.pitch -= deltaY * 0.005;
    // Limites verticais
    cameraState.pitch = Math.max(-Math.PI/4, Math.min(Math.PI/2.2, cameraState.pitch));

    touchStart.x = t.clientX; touchStart.y = t.clientY;
}, { passive: false });
document.addEventListener('touchend', () => isCameraTouch = false);

// Rede
socket.on('newPlayer', (p) => addRemotePlayer(p.id, p));
socket.on('playerDisconnect', (id) => { if(remotePlayers[id]) { scene.remove(remotePlayers[id]); delete remotePlayers[id]; }});
socket.on('playerMoved', (d) => { if(remotePlayers[d.id]) { remotePlayers[d.id].position.set(d.x, d.y, d.z); remotePlayers[d.id].rotation.y = d.rotation; }});

function addRemotePlayer(id, data) {
    gltfLoader.load('./assets/player.glb', (gltf) => {
        const mesh = gltf.scene;
        mesh.position.set(data.x, data.y, data.z);
        scene.add(mesh);
        remotePlayers[id] = mesh;
    });
}

function animate() {
    requestAnimationFrame(animate);
    updatePhysics();
    updateCameraAndMovement();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
