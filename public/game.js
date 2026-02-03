import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const socket = io();
let currentRoomId = null;
let myPlayerId = null;

// UI ELEMENTS
const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameUI = document.getElementById('game-ui');
const healthBar = document.getElementById('health-bar');
const interactBtn = document.getElementById('interact-btn');
const settingsModal = document.getElementById('settings-modal');
const slot2 = document.getElementById('slot-2');

// SETTINGS
let sensMultiplier = 0.005; // Padrão
document.getElementById('settings-btn').onclick = () => settingsModal.classList.remove('hidden');
document.getElementById('close-settings').onclick = () => {
    const val = document.getElementById('sens-slider').value;
    sensMultiplier = val * 0.001; // Ajuste fino
    settingsModal.classList.add('hidden');
};

// SOCKET AUTH & LOBBY (Igual ao anterior, resumido)
document.getElementById('btn-login').onclick = () => socket.emit('login', { user: document.getElementById('username').value, pass: document.getElementById('password').value });
document.getElementById('btn-register').onclick = () => socket.emit('register', { user: document.getElementById('username').value, pass: document.getElementById('password').value });
socket.on('authSuccess', () => { loginScreen.classList.add('hidden'); lobbyScreen.classList.remove('hidden'); socket.emit('refreshRooms'); });
document.getElementById('btn-create-room').onclick = () => socket.emit('createRoom', document.getElementById('new-room-name').value);
socket.on('roomList', (rooms) => {
    const list = document.getElementById('room-list'); list.innerHTML = '';
    rooms.forEach(r => {
        const btn = document.createElement('button'); btn.innerText = `${r.id} (${r.count})`;
        btn.onclick = () => socket.emit('joinRoom', r.id); list.appendChild(btn);
    });
});

socket.on('joinSuccess', (data) => {
    currentRoomId = data.roomId;
    myPlayerId = socket.id;
    lobbyScreen.classList.add('hidden');
    gameUI.classList.remove('hidden');
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    if (screen.orientation) screen.orientation.lock('landscape').catch(()=>{});
    
    initWorld(data.initialPos, data.players, data.loot);
});

// --- ENGINE ---
const script = document.createElement('script');
script.src = "https://cdnjs.cloudflare.com/ajax/libs/nipplejs/0.10.1/nipplejs.min.js";
script.onload = () => { /* Ready */ };
document.head.appendChild(script);

// AUDIO
const shotSound = new Audio('./assets/bl.mp3');

// CONTROLS
let jumpPressed = false;
let shootPressed = false;
document.getElementById('jump-btn').addEventListener('touchstart', (e) => { e.preventDefault(); jumpPressed = true; });
document.getElementById('shoot-btn').addEventListener('touchstart', (e) => { 
    e.preventDefault(); 
    handleShooting(); 
});
// Interact
interactBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    tryPickup();
});

// VARS
let scene, camera, renderer, localPlayerMesh;
const remotePlayers = {};
const lootMeshes = {}; // { id: Mesh }
const gltfLoader = new GLTFLoader();
const raycaster = new THREE.Raycaster();

const physics = { velocity_y: 0, gravity: 0.02, jumpForce: 0.5, speed: 0.4, hp: 100 };
const cameraState = { yaw: 0, pitch: 0.1, dist: 4, shoulderOffset: 1.5 };
const inputs = { forward: 0, turn: 0 };
let hasWeapon = false;

// --- INIT ---
function initWorld(initialPos, existingPlayers, lootData) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 10, 150);

    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    const amb = new THREE.AmbientLight(0xffffff, 0.6); scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(50, 100, 50); dir.castShadow = true; scene.add(dir);

    // Chão
    const txt = new THREE.TextureLoader().load('./assets/txt.png');
    txt.wrapS = THREE.RepeatWrapping; txt.wrapT = THREE.RepeatWrapping; txt.repeat.set(50, 50);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ map: txt }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

    // Players
    Object.keys(existingPlayers).forEach(id => { if (id !== socket.id) addRemotePlayer(id, existingPlayers[id]); });
    createLocalPlayer(initialPos);
    
    // Loot
    renderLoot(lootData);

    initJoystick();
    animate();
}

function createLocalPlayer(pos) {
    gltfLoader.load('./assets/player.glb', (gltf) => {
        localPlayerMesh = gltf.scene;
        localPlayerMesh.position.set(pos.x, pos.y, pos.z);
        scene.add(localPlayerMesh);
        physics.hp = pos.hp;
        updateHealthUI(physics.hp);
    });
}

// --- LOOT SYSTEM ---
function renderLoot(items) {
    // Usa uma caixa vermelha se nao tiver weapon.glb, ou tenta carregar
    // Para garantir visualização imediata, usaremos um cubo flutuante como placeholder ou o modelo
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });

    items.forEach(item => {
        // Tenta carregar modelo, fallback para cubo
        gltfLoader.load('./assets/weapon.glb', (gltf) => {
            const mesh = gltf.scene.clone();
            setupLootMesh(mesh, item);
        }, undefined, () => {
            const mesh = new THREE.Mesh(boxGeo, boxMat);
            setupLootMesh(mesh, item);
        });
    });
}

function setupLootMesh(mesh, item) {
    mesh.position.set(item.x, 1, item.z);
    mesh.userData = { id: item.id, type: item.type };
    
    // Animação de girar
    mesh.onBeforeRender = () => { mesh.rotation.y += 0.02; };
    
    scene.add(mesh);
    lootMeshes[item.id] = mesh;
}

function tryPickup() {
    if (!localPlayerMesh) return;
    let closest = null;
    let minDist = 3; // Distancia para pegar

    Object.keys(lootMeshes).forEach(key => {
        const mesh = lootMeshes[key];
        const dist = localPlayerMesh.position.distanceTo(mesh.position);
        if (dist < minDist) {
            closest = mesh.userData.id;
        }
    });

    if (closest) {
        socket.emit('pickupLoot', closest);
        hasWeapon = true;
        slot2.innerText = "Rifle";
        slot2.classList.add('active');
        document.getElementById('slot-1').classList.remove('active');
        interactBtn.classList.add('hidden');
    }
}

// Check Loot Distance Loop
function checkLootProximity() {
    if (!localPlayerMesh) return;
    let near = false;
    Object.values(lootMeshes).forEach(mesh => {
        if (localPlayerMesh.position.distanceTo(mesh.position) < 3) near = true;
    });
    
    if (near && !hasWeapon) interactBtn.classList.remove('hidden'); // Só mostra se não tiver arma (simplificação)
    else interactBtn.classList.add('hidden');
}

// --- SHOOTING ---
function handleShooting() {
    if (!hasWeapon) return; // Só atira se tiver arma
    
    // Tocar som local
    shotSound.currentTime = 0;
    shotSound.play();
    
    // Enviar evento de tiro (para som remoto)
    socket.emit('playerShoot');

    // Raycast (Hitscan)
    // Raycaster parte da Câmera em direção ao centro
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    
    // Pegar objetos colidíveis (Remote Players)
    const targets = Object.values(remotePlayers).map(m => m.children[0] || m); // Ajuste dependendo da estrutura do GLB
    const intersects = raycaster.intersectObjects(scene.children, true);

    for (let i = 0; i < intersects.length; i++) {
        const obj = intersects[i].object;
        // Ignora o próprio jogador e o chão
        if (obj === localPlayerMesh || localPlayerMesh.getObjectById(obj.id)) continue; 
        
        // Verifica se é um jogador remoto
        let hitPlayerId = null;
        Object.keys(remotePlayers).forEach(id => {
            const mesh = remotePlayers[id];
            // Verifica se o objeto atingido faz parte da mesh desse player
            let parent = obj;
            while(parent) {
                if (parent === mesh) { hitPlayerId = id; break; }
                parent = parent.parent;
            }
        });

        if (hitPlayerId) {
            // ACERTOU!
            console.log("Acertou player:", hitPlayerId);
            socket.emit('playerHit', hitPlayerId);
            break; // Só acerta o primeiro
        }
    }
}

// --- SOCKET EVENTS UPDATE ---
socket.on('remoteShoot', () => {
    // Tocar som (diminuir volume se longe seria ideal, mas aqui toca full)
    const s = shotSound.cloneNode();
    s.volume = 0.3;
    s.play();
});

socket.on('updateHealth', (data) => {
    if (data.id === myPlayerId) {
        physics.hp = data.hp;
        updateHealthUI(data.hp);
        // Efeito de tela vermelha rapidinho
        gameUI.style.backgroundColor = 'rgba(255,0,0,0.3)';
        setTimeout(() => gameUI.style.backgroundColor = 'transparent', 200);
    }
});

socket.on('playerRespawn', (data) => {
    if (data.id === myPlayerId) {
        localPlayerMesh.position.set(data.x, data.y, data.z);
        physics.hp = 100;
        updateHealthUI(100);
        hasWeapon = false; // Perde arma ao morrer
        slot2.innerText = "Vazio";
        slot2.classList.remove('active');
    }
});

socket.on('lootTaken', (id) => {
    if (lootMeshes[id]) {
        scene.remove(lootMeshes[id]);
        delete lootMeshes[id];
    }
});

function updateHealthUI(hp) {
    healthBar.style.width = `${hp}%`;
    if (hp < 30) healthBar.style.background = 'red';
    else healthBar.style.background = 'limegreen';
}

// --- PHYSICS & CAMERA (Atualizado com sensibilidade) ---
let touchStart = { x: 0, y: 0 };
let isCameraTouch = false;

document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t.target.closest('#joystick-zone') || t.target.closest('.action-btn') || t.target.closest('#interact-btn')) return;
    touchStart.x = t.clientX; touchStart.y = t.clientY; isCameraTouch = true;
}, { passive: false });

document.addEventListener('touchmove', (e) => {
    if (!isCameraTouch) return;
    const t = e.touches[0];
    const deltaX = t.clientX - touchStart.x;
    const deltaY = t.clientY - touchStart.y;
    
    // USA O MULTIPLICADOR DO SLIDER
    cameraState.yaw -= deltaX * sensMultiplier;
    cameraState.pitch -= deltaY * sensMultiplier;
    cameraState.pitch = Math.max(-Math.PI/4, Math.min(Math.PI/2.2, cameraState.pitch));

    touchStart.x = t.clientX; touchStart.y = t.clientY;
}, { passive: false });
document.addEventListener('touchend', () => isCameraTouch = false);

// ... (Resto da física e joystick igual, apenas adicione checkLootProximity no animate)

function animate() {
    requestAnimationFrame(animate);
    // ... updatePhysics ... (Código anterior)
    // ... updateCameraAndMovement ... (Código anterior)
    
    // NOVO:
    checkLootProximity();
    
    // FÍSICA E CÂMERA (Cópia resumida para contexto)
    if (localPlayerMesh) {
        const pos = localPlayerMesh.position;
        // Gravidade
        physics.velocity_y -= physics.gravity;
        pos.y += physics.velocity_y;
        if (pos.y <= 0 && pos.x > -250 && pos.x < 250 && pos.z > -250 && pos.z < 250) {
            pos.y = 0; physics.velocity_y = 0;
            if (jumpPressed) { physics.velocity_y = physics.jumpForce; jumpPressed = false; }
        } else if (pos.y < -50) { // Void kill
             physics.hp = 0; // Morre no void
             socket.emit('playerHit', myPlayerId); // Auto-dano
        }

        // Camera Logic
        const hDist = cameraState.dist * Math.cos(cameraState.pitch);
        const vDist = cameraState.dist * Math.sin(cameraState.pitch);
        const offsetX = hDist * Math.sin(cameraState.yaw);
        const offsetZ = hDist * Math.cos(cameraState.yaw);
        camera.position.set(pos.x + offsetX, pos.y + vDist + 1.5, pos.z + offsetZ);
        camera.lookAt(pos.x, pos.y + 1.5, pos.z);
        camera.translateX(cameraState.shoulderOffset);

        // Movimento
        if (inputs.forward !== 0 || inputs.turn !== 0) {
             const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
             const theta = Math.atan2(camDir.x, camDir.z);
             const moveX = inputs.turn * Math.cos(theta) + inputs.forward * Math.sin(theta);
             const moveZ = -inputs.turn * Math.sin(theta) + inputs.forward * Math.cos(theta);
             pos.x += moveX * physics.speed; pos.z += moveZ * physics.speed;
             localPlayerMesh.rotation.y = Math.atan2(moveX, moveZ);
             socket.emit('playerMove', { x: pos.x, y: pos.y, z: pos.z, rotation: localPlayerMesh.rotation.y });
        }
    }

    renderer.render(scene, camera);
}

// ... Resto dos loaders e socket listeners ... (igual anterior)
// Adicionar funções de addRemotePlayer igual
function addRemotePlayer(id, data) {
    gltfLoader.load('./assets/player.glb', (gltf) => {
        const mesh = gltf.scene;
        mesh.position.set(data.x, data.y, data.z);
        scene.add(mesh);
        remotePlayers[id] = mesh;
    });
}
function initJoystick() {
    const manager = nipplejs.create({
        zone: document.getElementById('joystick-zone'),
        mode: 'static', position: { left: '50%', top: '50%' }, color: 'white'
    });
    manager.on('move', (evt, data) => { if (data?.vector) { inputs.forward = data.vector.y; inputs.turn = data.vector.x; } });
    manager.on('end', () => { inputs.forward = 0; inputs.turn = 0; });
}
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
