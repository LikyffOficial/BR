import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- CONTROLE DE TELA CHEIA ---
const startBtn = document.getElementById('start-btn');
startBtn.addEventListener('click', () => {
    // Solicita tela cheia
    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen();
    }
    // Tenta travar orientação (funciona em Androids modernos/PWA)
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(e => console.log('Trava de rotação não suportada'));
    }
    startBtn.style.display = 'none';
    initWorld(); // Só inicia o jogo real após o clique
});

// --- IMPORTAR NIPPLE.JS DINAMICAMENTE ---
const script = document.createElement('script');
script.src = "https://cdnjs.cloudflare.com/ajax/libs/nipplejs/0.10.1/nipplejs.min.js";
script.onload = () => { /* Carregado */ };
document.head.appendChild(script);

// --- SETUP THREE.JS ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 10, 500);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement); // Canvas vai para o fundo

// Luzes
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

// --- INPUTS ---
const inputs = { forward: 0, turn: 0 };
let touchStartX = 0;
let isCameraTouch = false;

// --- LOADERS ---
const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();

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
    
    // Inicia Joystick
    initJoystick();
    
    // Inicia Loop
    animate();
}

function createLocalPlayer() {
    gltfLoader.load('./assets/player.glb', (gltf) => {
        localPlayerMesh = gltf.scene;
        localPlayerMesh.position.set(0, 0, 0);
        localPlayerMesh.traverse(c => { if(c.isMesh) c.castShadow = true; });
        scene.add(localPlayerMesh);
    });
}

// --- LÓGICA DE CONTROLES REFINADA ---

function initJoystick() {
    const zone = document.getElementById('joystick-zone');
    
    joystickManager = nipplejs.create({
        zone: zone,         // OBRIGA o joystick a ficar SÓ nesta div
        mode: 'static',     // Fixo no lugar
        position: { left: '50%', top: '50%' }, // Centralizado dentro da div zone
        color: 'white',
        size: 100
    });

    joystickManager.on('move', (evt, data) => {
        if (data && data.vector) {
            inputs.forward = data.vector.y;
            inputs.turn = data.vector.x;
        }
    });

    joystickManager.on('end', () => {
        inputs.forward = 0;
        inputs.turn = 0;
    });
}

// LÓGICA DE CÂMERA (Separada do Joystick)
document.addEventListener('touchstart', (e) => {
    // Verifica cada toque
    for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        
        // O elemento que foi tocado
        const target = t.target;
        
        // Se o toque foi DENTRO da zona do joystick, IGNORA para a câmera
        // O nipple.js cuida do joystick, nós só cuidamos do RESTO
        if (target.id === 'joystick-zone' || target.closest('#joystick-zone')) {
            continue; 
        }

        // Se chegou aqui, é toque na tela (Câmera)
        touchStartX = t.clientX;
        isCameraTouch = true;
    }
}, { passive: false });

document.addEventListener('touchmove', (e) => {
    if (!isCameraTouch || !localPlayerMesh) return;
    
    // Novamente, ignoramos toques que estão movendo o joystick visualmente
    // Mas aqui focamos no ID do toque que iniciou a câmera (simplificado pelo target)
    if (e.target.id === 'joystick-zone' || e.target.closest('#joystick-zone')) return;

    for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        
        // Lógica simples: se o movimento é longe da área do joystick (lado direito ou meio)
        // Uma verificação extra de segurança:
        if (t.clientX > 200) { // 200px é margem de segurança da zona esquerda
             const deltaX = t.clientX - touchStartX;
             localPlayerMesh.rotation.y -= deltaX * 0.005; 
             touchStartX = t.clientX;
        }
    }
}, { passive: false });

document.addEventListener('touchend', () => {
    isCameraTouch = false;
});


// --- GAME LOOP ---
function processInput() {
    if (!localPlayerMesh) return;

    let moved = false;
    const speed = 0.5;

    if (inputs.forward !== 0 || inputs.turn !== 0) {
        // Direção baseada na rotação do personagem
        const direction = new THREE.Vector3(inputs.turn, 0, -inputs.forward); // X = strafe, Z = frente
        direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), localPlayerMesh.rotation.y);
        direction.normalize().multiplyScalar(speed); // Normaliza para não correr mais rápido na diagonal

        // Aplica apenas se houver input real (evita tremedeira)
        if (inputs.forward !== 0 || inputs.turn !== 0) {
            localPlayerMesh.position.add(direction);
            moved = true;
        }
    }

    // Câmera segue
    const relativeCameraOffset = new THREE.Vector3(0, 5, 10);
    const cameraOffset = relativeCameraOffset.applyMatrix4(localPlayerMesh.matrixWorld);
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

// SOCKETS (Receber dados)
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

// Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
