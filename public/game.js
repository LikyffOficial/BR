import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- IMPORTAR NIPPLE.JS DINAMICAMENTE (Para o Joystick) ---
const script = document.createElement('script');
script.src = "https://cdnjs.cloudflare.com/ajax/libs/nipplejs/0.10.1/nipplejs.min.js";
script.onload = () => { initJoystick(); };
document.head.appendChild(script);

// --- INTERFACE MOBILE (Botão de Tiro) ---
const shootBtn = document.createElement('div');
shootBtn.style.position = 'absolute';
shootBtn.style.bottom = '50px';
shootBtn.style.right = '30px';
shootBtn.style.width = '60px';
shootBtn.style.height = '60px';
shootBtn.style.background = 'rgba(255, 0, 0, 0.5)';
shootBtn.style.borderRadius = '50%';
shootBtn.style.border = '2px solid white';
shootBtn.style.display = 'flex';
shootBtn.style.justifyContent = 'center';
shootBtn.style.alignItems = 'center';
shootBtn.style.color = 'white';
shootBtn.style.userSelect = 'none';
shootBtn.innerText = 'SHOOT';
shootBtn.addEventListener('touchstart', (e) => { e.preventDefault(); /* Lógica de tiro aqui */ });
document.body.appendChild(shootBtn);

// --- CONFIGURAÇÃO THREE.JS ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 10, 500);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(50, 50, 50);
dirLight.castShadow = true;
scene.add(dirLight);

// --- REDE ---
const socket = io();
const remotePlayers = {};
let localPlayerMesh = null;
let joystickManager = null;

// --- VARIÁVEIS DE CONTROLE ---
const inputs = {
    forward: 0, // Valor entre -1 e 1 (Joystick Y)
    turn: 0     // Valor entre -1 e 1 (Joystick X)
};
let touchStartX = 0;
let targetRotationY = 0; // Para rotação da câmera via touch

// --- LOADERS ---
const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

async function initWorld() {
    // Chão
    const groundTexture = textureLoader.load('./assets/txt.png');
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(50, 50);
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(500, 500),
        new THREE.MeshStandardMaterial({ map: groundTexture })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Jogador Local
    createLocalPlayer();
    
    // Inicia loop
    animate();
}

function createLocalPlayer() {
    gltfLoader.load('./assets/player.glb', (gltf) => {
        localPlayerMesh = gltf.scene;
        localPlayerMesh.position.set(0, 0, 0);
        scene.add(localPlayerMesh);
        document.getElementById('loading').style.display = 'none';
    });
}

// --- CONTROLES MOBILE ---

// 1. Joystick (Movimento)
function initJoystick() {
    const options = {
        zone: document.body,
        mode: 'static',
        position: { left: '50%', top: '50%' }, // Placeholder, será sobrescrito pelo CSS abaixo se quisesse, mas nipple usa position absoluta
        position: { left: '100px', bottom: '100px' },
        color: 'white',
        size: 100
    };
    
    joystickManager = nipplejs.create(options);

    joystickManager.on('move', (evt, data) => {
        if (data && data.vector) {
            // Nipple retorna vetor normalizado (y invertido no canvas geralmente, mas aqui y+ é pra cima no joystick)
            inputs.forward = data.vector.y; 
            inputs.turn = data.vector.x; 
        }
    });

    joystickManager.on('end', () => {
        inputs.forward = 0;
        inputs.turn = 0;
    });
}

// 2. Touch Swipe (Rotação da Câmera/Personagem)
// Usamos a metade direita da tela para rotacionar
document.addEventListener('touchstart', (e) => {
    for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.clientX > window.innerWidth / 2) { // Tocou na direita
            touchStartX = t.clientX;
        }
    }
}, { passive: false });

document.addEventListener('touchmove', (e) => {
    // Evita scroll da tela
    e.preventDefault(); 
    
    for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.clientX > window.innerWidth / 2) {
            const deltaX = t.clientX - touchStartX;
            // Sensibilidade da rotação
            if (localPlayerMesh) {
                localPlayerMesh.rotation.y -= deltaX * 0.005; 
            }
            touchStartX = t.clientX;
        }
    }
}, { passive: false });

// 3. Suporte a Teclado (Para testar no PC)
window.addEventListener('keydown', (e) => {
    if(e.key === 'w') inputs.forward = 1;
    if(e.key === 's') inputs.forward = -1;
    if(e.key === 'a') inputs.turn = -1;
    if(e.key === 'd') inputs.turn = 1;
});
window.addEventListener('keyup', (e) => {
    if(['w','s'].includes(e.key)) inputs.forward = 0;
    if(['a','d'].includes(e.key)) inputs.turn = 0;
});


// --- LÓGICA DO JOGO ---
function processInput() {
    if (!localPlayerMesh) return;

    let moved = false;
    const speed = 0.5;

    // Movimento relativo à rotação atual do personagem
    if (inputs.forward !== 0) {
        // Mover para frente/trás na direção que o boneco está olhando
        const dir = new THREE.Vector3(0, 0, -1); // Frente no Three.js geralmente é Z negativo local
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), localPlayerMesh.rotation.y);
        
        localPlayerMesh.position.addScaledVector(dir, inputs.forward * speed);
        moved = true;
    }

    if (inputs.turn !== 0) {
        // Opção A: O joystick vira o boneco (estilo carro)
        // localPlayerMesh.rotation.y -= inputs.turn * 0.05;
        
        // Opção B: O joystick faz "strafe" (andar de lado) - Melhor para shooters
        const dir = new THREE.Vector3(1, 0, 0); // Direita local
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), localPlayerMesh.rotation.y);
        localPlayerMesh.position.addScaledVector(dir, inputs.turn * speed);
        moved = true;
    }

    // Atualiza Câmera (Segue o jogador de trás e um pouco acima)
    const relativeCameraOffset = new THREE.Vector3(0, 5, 10);
    // Aplica a rotação do jogador ao offset da câmera para que ela gire junto
    const cameraOffset = relativeCameraOffset.applyMatrix4(localPlayerMesh.matrixWorld);
    
    // Interpolação suave da câmera (Lerp)
    camera.position.lerp(cameraOffset, 0.1);
    camera.lookAt(localPlayerMesh.position.x, localPlayerMesh.position.y + 2, localPlayerMesh.position.z);

    // Rede
    if (moved) {
        socket.emit('playerMove', {
            x: localPlayerMesh.position.x,
            y: localPlayerMesh.position.y,
            z: localPlayerMesh.position.z,
            rotation: localPlayerMesh.rotation.y
        });
    }
}

// --- SOCKET EVENTS (REMOTOS) ---
socket.on('currentPlayers', (players) => {
    Object.keys(players).forEach((id) => {
        if (id !== socket.id) addRemotePlayer(id, players[id]);
    });
});
socket.on('newPlayer', (p) => addRemotePlayer(p.id, p));
socket.on('playerDisconnect', (id) => {
    if (remotePlayers[id]) { scene.remove(remotePlayers[id]); delete remotePlayers[id]; }
});
socket.on('playerMoved', (data) => {
    const p = remotePlayers[data.id];
    if (p) {
        p.position.set(data.x, data.y, data.z);
        p.rotation.y = data.rotation;
    }
});

function addRemotePlayer(id, data) {
    gltfLoader.load('./assets/player.glb', (gltf) => {
        const mesh = gltf.scene;
        mesh.position.set(data.x, data.y, data.z);
        mesh.rotation.y = data.rotation;
        scene.add(mesh);
        remotePlayers[id] = mesh;
    });
}

function animate() {
    requestAnimationFrame(animate);
    processInput();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

initWorld();
