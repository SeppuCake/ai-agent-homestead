import "./style.css";
import typescriptLogo from "./assets/typescript.svg";
import viteLogo from "./assets/vite.svg";
import heroImg from "./assets/hero.png";
import { setupCounter } from "./counter.ts";
import * as THREE from "three";
import mosinIdleUrl from "./assets/mosin-idle.png";

type AgentStatus = "idle" | "working" | "walking" | "waiting" | "done";

interface AgentProfile {
	id: string;
	name: string;
	status: AgentStatus;
	color: string;
}

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
	throw new Error("Could not find the #app element");
}

const mosinProfile: AgentProfile = {
	id: "mosin",
	name: "Mosin",
	status: "idle",
	color: "#7688a8",
};

const scene = new THREE.Scene();

scene.background = new THREE.Color("#20182b");

// Tile init & declare
const tileSize = 0.9;
const columns = 7;
const rows = 3;

const tileGeometry = new THREE.PlaneGeometry(tileSize, tileSize);

const tileMaterials = [
	new THREE.MeshBasicMaterial({ color: "#7f9b62" }),
	new THREE.MeshBasicMaterial({ color: "#718b57" }),
];

for (let row = 0; row < rows; row += 1) {
	for (let column = 0; column < columns; column += 1) {
		const materialIndex = (row + column) % tileMaterials.length;
		const tile = new THREE.Mesh(tileGeometry, tileMaterials[materialIndex]);

		tile.position.set(
			column - (columns - 1) / 2,
			row - (rows - 1) / 2 - 0.75,
			0,
		);

		scene.add(tile);
	}
}

const workstation = new THREE.Group();
const deskMaterial = new THREE.MeshBasicMaterial({
	color: "#6b4f3a",
});

const screenMaterial = new THREE.MeshBasicMaterial({
	color: "#70d6d0",
});

const deskTop = new THREE.Mesh(
	new THREE.PlaneGeometry(0.9, 0.16),
	deskMaterial,
);

deskTop.position.set(0, -0.1, 0.3);

const deskLeg = new THREE.Mesh(
	new THREE.PlaneGeometry(0.14, 0.6),
	deskMaterial,
);

deskLeg.position.set(0, -0.42, 0.3);

const monitor = new THREE.Mesh(
	new THREE.PlaneGeometry(0.5, 0.34),
	screenMaterial,
);

monitor.position.set(0, 0.18, 0.4);

workstation.add(deskTop, deskLeg, monitor);
workstation.position.set(2.7, -0.75, 0);

scene.add(workstation);

// CAMERA init & declare
const camera = new THREE.OrthographicCamera(-4, 4, 2.25, -2.25, 0.1, 100);

camera.position.z = 10;

const renderer = new THREE.WebGLRenderer({
	antialias: false,
});

renderer.setSize(640, 360);
renderer.setPixelRatio(1);

const mosinTexture = new THREE.TextureLoader().load(mosinIdleUrl, () => {
	renderer.render(scene, camera);
});

mosinTexture.colorSpace = THREE.SRGBColorSpace;
mosinTexture.magFilter = THREE.NearestFilter;
mosinTexture.minFilter = THREE.NearestFilter;

const mosinMaterial = new THREE.SpriteMaterial({
	map: mosinTexture,
	transparent: true,
});

const mosinSprite = new THREE.Sprite(mosinMaterial);

mosinSprite.scale.set(1.3, 1.95, 1);
mosinSprite.position.set(0, -0.75, 1);

scene.add(mosinSprite);

//Positions for Mosin to move back and from
const homePosition = new THREE.Vector3(0, -0.75, 1);
const workPosition = new THREE.Vector3(1.7, -0.75, 1);

let movementFrame: number | null = null;

function moveMosin(destination: THREE.Vector3, arrivalStatus: AgentStatus) {
	setMosinStatus("walking");
	if (movementFrame !== null) {
		cancelAnimationFrame(movementFrame);
	}

	const startingPosition = mosinSprite.position.clone();
	const startedAt = performance.now();
	const duration = 900;

	function animate(currentTime: number) {
		const elapsed = currentTime - startedAt;
		const progress = Math.min(elapsed / duration, 1);
		const easedProgress = 1 - (1 - progress) ** 2;

		mosinSprite.position.lerpVectors(
			startingPosition,
			destination,
			easedProgress,
		);

		renderer.render(scene, camera);

		if (progress < 1) {
			movementFrame = requestAnimationFrame(animate);
		} else {
			movementFrame = null;
			setMosinStatus(arrivalStatus);
		}
	}

	movementFrame = requestAnimationFrame(animate);
}
app.innerHTML = /*html*/ `
<section id="center">
  <div class="hero">
    <img src="${heroImg}" class="base" width="170" height="179">
    <img src="${typescriptLogo}" class="framework" alt="TypeScript logo"/>
    <img src="${viteLogo}" class="vite" alt="Vite logo" />
  </div>
  <div>
    <h1>Agent Homestead</h1>
    <p>
      <strong>${mosinProfile.name}</strong>
      is currently <span id="mosin-status">${mosinProfile.status}</span>.
    </p>
    <button id="move-mosin" type="button"> Send Mosin to work</button>
  </div>
  <button id="counter" type="button" class="counter"></button>
</section>

<div class="ticks"></div>

<section id="next-steps">
  <div id="docs">
    <svg class="icon" role="presentation" aria-hidden="true"><use href="/icons.svg#documentation-icon"></use></svg>
    <h2>Documentation</h2>
    <p>Your questions, answered</p>
    <ul>
      <li>
        <a href="https://vite.dev/" target="_blank">
          <img class="logo" src="${viteLogo}" alt="" />
          Explore Vite
        </a>
      </li>
      <li>
        <a href="https://www.typescriptlang.org" target="_blank">
          <img class="button-icon" src="${typescriptLogo}" alt="">
          Learn more
        </a>
      </li>
    </ul>
  </div>
  <div id="social">
    <svg class="icon" role="presentation" aria-hidden="true"><use href="/icons.svg#social-icon"></use></svg>
    <h2>Connect with us</h2>
    <p>Join the Vite community</p>
    <ul>
      <li><a href="https://github.com/vitejs/vite" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="/icons.svg#github-icon"></use></svg>GitHub</a></li>
      <li><a href="https://chat.vite.dev/" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="/icons.svg#discord-icon"></use></svg>Discord</a></li>
      <li><a href="https://x.com/vite_js" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="/icons.svg#x-icon"></use></svg>X.com</a></li>
      <li><a href="https://bsky.app/profile/vite.dev" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="/icons.svg#bluesky-icon"></use></svg>Bluesky</a></li>
    </ul>
  </div>
</section>

<div class="ticks"></div>
<section id="spacer"></section>
`;

setupCounter(document.querySelector<HTMLButtonElement>("#counter")!);

const moveMosinButton =
	document.querySelector<HTMLButtonElement>("#move-mosin");

if (!moveMosinButton) {
	throw new Error("Could not find the #move-mosin button");
}

let mosinIsWorking = false;

moveMosinButton.addEventListener("click", () => {
	mosinIsWorking = !mosinIsWorking;

	moveMosin(
		mosinIsWorking ? workPosition : homePosition,
		mosinIsWorking ? "working" : "idle",
	);

	moveMosinButton.textContent = mosinIsWorking
		? "Send Mosin home"
		: "Send Mosin to work";
});

function setMosinStatus(status: AgentStatus) {
	const statusText = document.querySelector<HTMLSpanElement>("#mosin-status");

	if (!statusText) {
		throw new Error("Could not find the #mosin-status element");
	}

	mosinProfile.status = status;
	statusText.textContent = status;
}

app.prepend(renderer.domElement);
renderer.render(scene, camera);
