import "./style.css";
import typescriptLogo from "./assets/typescript.svg";
import viteLogo from "./assets/vite.svg";
import heroImg from "./assets/hero.png";
import { setupCounter } from "./counter.ts";
import * as THREE from "three";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
	throw new Error("Could not find the #app element");
}

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

// CAMERA init & declare
const camera = new THREE.OrthographicCamera(-4, 4, 2.25, -2.25, 0.1, 100);

camera.position.z = 10;

const renderer = new THREE.WebGLRenderer({
	antialias: false,
});

renderer.setSize(640, 360);
renderer.setPixelRatio(1);

app.innerHTML = /*html*/ `
<section id="center">
  <div class="hero">
    <img src="${heroImg}" class="base" width="170" height="179">
    <img src="${typescriptLogo}" class="framework" alt="TypeScript logo"/>
    <img src="${viteLogo}" class="vite" alt="Vite logo" />
  </div>
  <div>
    <h1>Agent Homestead</h1>
    <p>Edit <code>src/main.ts</code> and save to test <code>HMR</code></p>
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

app.prepend(renderer.domElement);
renderer.render(scene, camera);
