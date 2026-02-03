import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- INICIALIZAÇÃO E UI ---
const startBtn = document.getElementById('start-btn');
startBtn.addEventListener('click', () => {
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    startBtn.style.display = 'none';
    initWorld();
});

// Nipple.js Loader
const script = document.createElement('script');
script.src = "https://cdnjs.cloudflare.com/ajax/libs/nipplejs/0.10.1/nipplejs.min.js";
script.onload = () => { /* Nipple pronto */ };
document.head.appendChild(script);

// Controles de Ação
let jumpPressed = false;
document.getElementById('jump-btn').addEventListener('touchstart', (e) => { e.preventDefault(); jumpPressed = true; });

// --- CENA THREE.JS ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 10, 100); // Neblina ajustada

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(20, 50, 20);
dirLight.castShadow = true;
// Otimização de sombras
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
scene.add(dirLight);

// --- ESTADO DO JOGO ---
const socket = io();
const remotePlayers = {};
let localPlayerMesh = null;
let mixer = null; // Para animações no futuro

// Física e Movimento
const physics = {
    velocity_y: 0,
    gravity: 0.02,
    jumpForce: 0.5,
    isGrounded: false,
    speed: 0.4
};

// Câmera Orbital (Free Fire Style)
const cameraState = {
    yaw: 0,   // Rotação horizontal (radianos)
    pitch: 0.3, // Rotação vertical (radianos) - começa levemente olhando de cima
    dist: 8   // Distância da câmera ao personagem
};

// Inputs
const inputs = { forward: 0, turn: 0 };
let touchStart = { x: 0, y: 0 };
let isCameraTouch = false;

// Loaders
const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();

// --- INICIALIZAÇÃO ---
async function initWorld() {
    // Chão
    const groundTexture = textureLoader.load('./assets/txt.png');
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(100, 100);
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(1000, 1000),
        new THREE.MeshStandardMaterial({ map: groundTexture })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    createLocalPlayer();
    initJoystick();
    animate();
}

function createLocalPlayer() {
    gltfLoader.load('./assets/player.glb', (gltf) => {
        localPlayerMesh = gltf.scene;
        // Ajuste de escala se necessário (depende do seu modelo)
        localPlayerMesh.scale.set(1, 1, 1); 
        localPlayerMesh.traverse(c => { if(c.isMesh) c.castShadow = true; });
        scene.add(localPlayerMesh);
    });
}

// --- CONTROLES (TOUCH) ---
function initJoystick() {
    const zone = document.getElementById('joystick-zone');
    const manager = nipplejs.create({
        zone: zone, mode: 'static', position: { left: '50%', top: '50%' }, color: 'white'
    });
    manager.on('move', (evt, data) => {
        if (data && data.vector) {
            inputs.forward = data.vector.y;
            inputs.turn = data.vector.x;
        }
    });
    manager.on('end', () => { inputs.forward = 0; inputs.turn = 0; });
}

// Lógica de Câmera (Deslizar dedo na tela)
document.addEventListener('touchstart', (e) => {
    for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.target.id === 'joystick-zone' || t.target.closest('#joystick-zone')) continue;
        if (t.target.classList.contains('action-btn')) continue;

        // Tocou na área livre (Câmera)
        touchStart.x = t.clientX;
        touchStart.y = t.clientY;
        isCameraTouch = true;
    }
}, { passive: false });

document.addEventListener('touchmove', (e) => {
    if (!isCameraTouch) return;
    e.preventDefault(); 

    for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.target.id === 'joystick-zone' || t.target.closest('#joystick-zone')) continue;

        // Se o toque se moveu significativamente
        const deltaX = t.clientX - touchStart.x;
        const deltaY = t.clientY - touchStart.y;

        // Sensibilidade
        cameraState.yaw -= deltaX * 0.005;
        cameraState.pitch -= deltaY * 0.005;

        // Travar Pitch (Não dar cambalhota completa)
        // Limita entre olhar quase tudo pra cima e olhar de cima pra baixo
        const minPitch = -Math.PI / 6; // -30 graus
        const maxPitch = Math.PI / 2.5; // ~70 graus
        cameraState.pitch = Math.max(minPitch, Math.min(maxPitch, cameraState.pitch));

        touchStart.x = t.clientX;
        touchStart.y = t.clientY;
    }
}, { passive: false });

document.addEventListener('touchend', () => { isCameraTouch = false; });

// --- LÓGICA DO JOGO E FÍSICA ---
function updatePhysics() {
    if (!localPlayerMesh) return;

    // 1. Gravidade
    physics.velocity_y -= physics.gravity;
    localPlayerMesh.position.y += physics.velocity_y;

    // 2. Colisão com Chão (Chão está em Y=0)
    if (localPlayerMesh.position.y <= 0) {
        localPlayerMesh.position.y = 0;
        physics.velocity_y = 0;
        physics.isGrounded = true;
    } else {
        physics.isGrounded = false;
    }

    // 3. Pulo
    if (jumpPressed) {
        if (physics.isGrounded) {
            physics.velocity_y = physics.jumpForce;
        }
        jumpPressed = false; // Reset imediato do input
    }
}

function updateMovementAndCamera() {
    if (!localPlayerMesh) return;

    // --- POSICIONAR CÂMERA ---
    // A câmera orbita em torno do jogador usando Trigonometria Esférica
    // Offset da câmera relativo ao jogador
    const hDist = cameraState.dist * Math.cos(cameraState.pitch); // Distância horizontal
    const vDist = cameraState.dist * Math.sin(cameraState.pitch); // Distância vertical (altura)

    const offsetX = hDist * Math.sin(cameraState.yaw);
    const offsetZ = hDist * Math.cos(cameraState.yaw);

    // Nova Posição da Câmera
    camera.position.x = localPlayerMesh.position.x + offsetX;
    camera.position.z = localPlayerMesh.position.z + offsetZ;
    camera.position.y = localPlayerMesh.position.y + vDist + 2; // +2 para mirar no ombro/cabeça

    // A câmera sempre olha para o jogador (mais um pouco para cima para a mira ficar centralizada no mundo)
    camera.lookAt(localPlayerMesh.position.x, localPlayerMesh.position.y + 1.5, localPlayerMesh.position.z);


    // --- MOVER JOGADOR ---
    let moved = false;
    
    // Se houver input do joystick
    if (inputs.forward !== 0 || inputs.turn !== 0) {
        // Calcular o ângulo frontal da CÂMERA (apenas no plano horizontal Y)
        // Queremos que "Frente" no joystick seja "Frente" da visão da câmera
        const cameraDir = new THREE.Vector3();
        camera.getWorldDirection(cameraDir);
        const theta = Math.atan2(cameraDir.x, cameraDir.z); // Ângulo da câmera

        // Calcular vetor de movimento baseado no joystick + ângulo da câmera
        // forward (Y do joystick) é invertido no cálculo 3D padrão
        const moveX = inputs.turn * Math.cos(theta) + inputs.forward * Math.sin(theta);
        const moveZ = -inputs.turn * Math.sin(theta) + inputs.forward * Math.cos(theta);

        localPlayerMesh.position.x += moveX * physics.speed;
        localPlayerMesh.position.z += moveZ * physics.speed;

        // Rotacionar o PERSONAGEM para olhar para onde está andando
        const moveAngle = Math.atan2(moveX, moveZ);
        // Suavizar rotação (Lerp)
        const targetRot = moveAngle;
        // Lógica simples para rotação mais curta
        localPlayerMesh.rotation.y = targetRot;

        moved = true;
    }

    // --- ENVIAR REDE ---
    // Enviamos a posição se moveu ou se está pulando/caindo (y mudou)
    if (moved || Math.abs(physics.velocity_y) > 0) {
        socket.emit('playerMove', {
            x: localPlayerMesh.position.x,
            y: localPlayerMesh.position.y,
            z: localPlayerMesh.position.z,
            rotation: localPlayerMesh.rotation.y
        });
    }
}

// --- REDE (OUTROS JOGADORES) ---
// Mesma lógica de antes, apenas garante atualização
socket.on('currentPlayers', (players) => {
    Object.keys(players).forEach(id => { if(id !== socket.id) addRemotePlayer(id, players[id]); });
});
socket.on('newPlayer', (p) => addRemotePlayer(p.id, p));
socket.on('playerDisconnect', (id) => {
    if (remotePlayers[id]) { scene.remove(remotePlayers[id]); delete remotePlayers[id]; }
});
socket.on('playerMoved', (data) => {
    const p = remotePlayers[data.id];
    if (p) {
        // Interpolação simples
        p.position.set(data.x, data.y, data.z);
        p.rotation.y = data.rotation;
    }
});

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
    updateMovementAndCamera();
    renderer.render(scene, camera);
}

// Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
