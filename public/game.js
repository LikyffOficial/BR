import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- CONFIGURAÇÃO INICIAL ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Céu azul simples
scene.fog = new THREE.Fog(0x87CEEB, 10, 500); // Neblina para profundidade

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; // Habilitar sombras
document.body.appendChild(renderer.domElement);

// Luzes
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(50, 50, 50);
dirLight.castShadow = true;
scene.add(dirLight);

// --- GERENCIAMENTO DE REDE ---
const socket = io();
const remotePlayers = {}; // Armazena os meshes dos outros jogadores
let localPlayerMesh = null; // Mesh do jogador local
let playerId = null;

// --- CARREGADORES ---
const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

// --- CRIAÇÃO DO MUNDO ---
async function initWorld() {
    // 1. Chão (Ground)
    const groundTexture = textureLoader.load('./assets/txt.png');
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(50, 50); // Repete a textura 50x50 vezes

    const groundGeo = new THREE.PlaneGeometry(500, 500);
    const groundMat = new THREE.MeshStandardMaterial({ map: groundTexture });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // 2. Casas (Houses) - Espalhamento aleatório
    gltfLoader.load('./assets/house.glb', (gltf) => {
        const houseModel = gltf.scene;
        // Instancia 20 casas aleatórias
        for (let i = 0; i < 20; i++) {
            const house = houseModel.clone();
            const x = (Math.random() - 0.5) * 400; // Random entre -200 e 200
            const z = (Math.random() - 0.5) * 400;
            house.position.set(x, 0, z);
            
            // Escala ajustável caso o modelo venha muito grande/pequeno
            house.scale.set(1.5, 1.5, 1.5); 
            house.castShadow = true;
            house.receiveShadow = true;
            scene.add(house);
        }
    }, undefined, (error) => console.error('Erro ao carregar casa:', error));

    // 3. Inicializar Jogador Local
    createLocalPlayer();
}

function createLocalPlayer() {
    gltfLoader.load('./assets/player.glb', (gltf) => {
        localPlayerMesh = gltf.scene;
        localPlayerMesh.position.set(0, 0, 0); // Inicia no centro
        localPlayerMesh.traverse((child) => {
            if (child.isMesh) child.castShadow = true;
        });
        scene.add(localPlayerMesh);

        // Remove tela de loading
        document.getElementById('loading').style.display = 'none';

        // Configurar controles básicos de teclado
        setupControls();
        
        // Iniciar loop de animação apenas após carregar o player
        animate();
    }, undefined, (error) => console.error('Erro ao carregar player:', error));
}

// --- LÓGICA MULTIPLAYER (CLIENTE) ---

// 1. Receber lista de jogadores que JÁ estão no servidor
socket.on('currentPlayers', (players) => {
    Object.keys(players).forEach((id) => {
        if (id !== socket.id) {
            addRemotePlayer(id, players[id]);
        }
    });
});

// 2. Novo jogador entrou
socket.on('newPlayer', (playerInfo) => {
    addRemotePlayer(playerInfo.id, playerInfo);
});

// 3. Jogador desconectou
socket.on('playerDisconnect', (id) => {
    if (remotePlayers[id]) {
        scene.remove(remotePlayers[id]);
        delete remotePlayers[id];
    }
});

// 4. Jogador se moveu
socket.on('playerMoved', (data) => {
    const remotePlayer = remotePlayers[data.id];
    if (remotePlayer) {
        // Interpolação simples poderia ser aplicada aqui
        remotePlayer.position.set(data.x, data.y, data.z);
        remotePlayer.rotation.y = data.rotation;
    }
});

function addRemotePlayer(id, data) {
    gltfLoader.load('./assets/player.glb', (gltf) => {
        const remoteMesh = gltf.scene;
        remoteMesh.position.set(data.x, data.y, data.z);
        remoteMesh.rotation.y = data.rotation;
        
        // Opcional: Adicionar uma cor ou tag para diferenciar inimigos
        
        scene.add(remoteMesh);
        remotePlayers[id] = remoteMesh;
    });
}

// --- CONTROLES DO JOGADOR LOCAL ---
const keys = { w: false, a: false, s: false, d: false };
const speed = 0.5;

function setupControls() {
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (keys.hasOwnProperty(key)) keys[key] = true;
    });
    window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (keys.hasOwnProperty(key)) keys[key] = false;
    });
}

function processInput() {
    if (!localPlayerMesh) return;

    let moved = false;
    const oldPosition = localPlayerMesh.position.clone();
    const oldRotation = localPlayerMesh.rotation.y;

    // Movimentação simples (Relativa ao Mundo)
    // Para Battle Royale real, o ideal é mover relativo à câmera
    if (keys.w) { localPlayerMesh.position.z -= speed; localPlayerMesh.rotation.y = Math.PI; moved = true; }
    if (keys.s) { localPlayerMesh.position.z += speed; localPlayerMesh.rotation.y = 0; moved = true; }
    if (keys.a) { localPlayerMesh.position.x -= speed; localPlayerMesh.rotation.y = -Math.PI / 2; moved = true; }
    if (keys.d) { localPlayerMesh.position.x += speed; localPlayerMesh.rotation.y = Math.PI / 2; moved = true; }

    // Atualizar Câmera (Terceira Pessoa)
    const cameraOffset = new THREE.Vector3(0, 5, 10); // 5 pra cima, 10 pra trás
    const cameraPos = localPlayerMesh.position.clone().add(cameraOffset);
    camera.position.lerp(cameraPos, 0.1); // Suavização da câmera
    camera.lookAt(localPlayerMesh.position);

    // Enviar dados ao servidor apenas se moveu
    if (moved) {
        socket.emit('playerMove', {
            x: localPlayerMesh.position.x,
            y: localPlayerMesh.position.y,
            z: localPlayerMesh.position.z,
            rotation: localPlayerMesh.rotation.y
        });
    }
}

// --- LOOP DE RENDERIZAÇÃO ---
function animate() {
    requestAnimationFrame(animate);
    
    processInput();
    
    renderer.render(scene, camera);
}

// Ajuste de janela
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Inicia tudo
initWorld();
