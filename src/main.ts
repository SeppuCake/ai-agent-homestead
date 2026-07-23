import * as THREE from "three";
import "./style.css";
import { initStudio } from "./studio";
import avatarWalkAtlasUrl from "./assets/agent-avatar-walk-atlas-v1.png";
import homesteadBackgroundUrl from "./assets/homestead-locations-background-v1.png";
import mosinIdleUrl from "./assets/mosin-idle-cafe-sheet-v2.png";
import mosinWaitingUrl from "./assets/mosin-waiting-sheet-v1.png";
import mosinWalkingUrl from "./assets/mosin-walking-atlas-v3-aligned.png";
import mosinWorkingUrl from "./assets/mosin-working-sheet-v1.png";

type AgentStatus = "idle" | "walking" | "waiting" | "working" | "done";
type DestinationStatus = "idle" | "waiting" | "working";
type ConnectionMode = "connecting" | "live" | "demo" | "offline";

interface AnimationDefinition {
	texture: THREE.Texture;
	frameCount: number;
	columns: number;
	rows: number;
	displaySize: THREE.Vector2;
	visualOffset: THREE.Vector2;
	fps: number;
	loop: boolean;
}

interface AnimationOptions {
	url: string;
	frameCount: number;
	columns: number;
	rows: number;
	displaySize: THREE.Vector2;
	visualOffset: THREE.Vector2;
	fps: number;
	loop: boolean;
}

interface ActivityEvent {
	type: "activity";
	status: AgentStatus;
	message: string;
	agentId?: string | null;
	agentName?: string;
	stage?: string;
}

interface ConnectionEvent {
	type: "connection";
	mode: ConnectionMode;
	message: string;
}

interface LogEvent {
	type: "log";
	message: string;
	kind?: string;
}

interface ResultEvent {
	type: "result";
	text: string;
}

interface StudioBridgeEvent {
	type:
		| "session-message"
		| "workflow"
		| "agents-changed"
		| "catalog"
		| "agent-activity"
		| "agent-result";
	[key: string]: unknown;
}

interface TeamVisual {
	id: string;
	name: string;
	avatar: string;
	role: string;
}

interface TeamAgentRuntime {
	agent: TeamVisual;
	root: THREE.Group;
	sprite: THREE.Sprite;
	material: THREE.SpriteMaterial;
	texture: THREE.Texture;
	animated: boolean;
	frame: number;
	state: AgentStatus;
	facingLeft: boolean;
	movement: {
		from: THREE.Vector3;
		to: THREE.Vector3;
		startedAt: number;
		duration: number;
		arrivalState: AgentStatus;
	} | null;
}

type BridgeEvent =
	| ActivityEvent
	| ConnectionEvent
	| LogEvent
	| ResultEvent
	| StudioBridgeEvent;

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
	throw new Error("Could not find the #app element");
}

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true">AH</span>
        <div>
          <p class="eyebrow">LOCAL AGENT TERRARIUM</p>
          <h1>Agent Homestead</h1>
        </div>
      </div>
      <div id="connection-pill" class="connection-pill is-connecting">
        <span class="connection-dot" aria-hidden="true"></span>
        <span id="connection-label">Connecting to Codex…</span>
      </div>
    </header>

    <main class="dashboard">
      <section class="world-panel panel" aria-labelledby="world-title">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">HOMESTEAD MAP</p>
            <h2 id="world-title">Mosin's Workday</h2>
          </div>
          <div class="agent-state">
            <span id="status-badge" class="status-badge">IDLE</span>
            <span id="activity-text">Enjoying a quiet café break.</span>
          </div>
        </div>

        <div id="world-frame" class="world-frame">
          <div class="world-vignette" aria-hidden="true"></div>
          <div id="done-burst" class="done-burst" aria-hidden="true">TASK COMPLETE!</div>
        </div>

        <div class="station-controls" aria-label="Send Mosin to a location">
          <button class="station-button" data-destination="idle" type="button">
            <span class="station-icon café" aria-hidden="true">☕</span>
            Café
          </button>
          <button class="station-button" data-destination="waiting" type="button">
            <span class="station-icon maintenance" aria-hidden="true">✦</span>
            Maintenance
          </button>
          <button class="station-button" data-destination="working" type="button">
            <span class="station-icon range" aria-hidden="true">◎</span>
            Work range
          </button>
        </div>
      </section>

      <aside class="control-panel panel" aria-labelledby="control-title">
        <div class="panel-heading compact">
          <div>
            <p class="eyebrow">CODEX BRIDGE</p>
            <h2 id="control-title">Give Mosin a task</h2>
          </div>
          <span class="privacy-chip">READ-ONLY</span>
        </div>

        <form id="task-form" class="task-form">
          <label for="task-prompt">Local Codex task</label>
          <textarea
            id="task-prompt"
            maxlength="4000"
            rows="4"
            placeholder="Inspect this repository and suggest the single best next improvement."
          ></textarea>
          <div class="task-actions">
            <button id="run-task" class="primary-button" type="submit">
              Send to Codex
            </button>
            <button id="run-demo" class="secondary-button" type="button">
              Run demo
            </button>
          </div>
          <p id="task-hint" class="task-hint">
            The local bridge inherits your Codex login. No key is stored in the browser.
          </p>
        </form>

        <section class="result-card" aria-labelledby="result-title">
          <div class="section-title-row">
            <h3 id="result-title">Latest result</h3>
            <button id="clear-result" class="text-button" type="button">Clear</button>
          </div>
          <p id="result-text">No completed Codex task yet.</p>
        </section>

        <section class="activity-card" aria-labelledby="activity-title">
          <div class="section-title-row">
            <h3 id="activity-title">Activity feed</h3>
            <span id="event-count">0 events</span>
          </div>
          <ol id="activity-feed" class="activity-feed" aria-live="polite"></ol>
        </section>
      </aside>
    </main>

    <footer class="footer">
      <span>Three.js pixel renderer · 640 × 360</span>
      <span id="footer-mode">Bridge starting…</span>
    </footer>
  </div>
`;

function requireElement<T extends Element>(selector: string): T {
	const element = document.querySelector<T>(selector);

	if (!element) {
		throw new Error(`Could not find ${selector}`);
	}

	return element;
}

const worldFrame = requireElement<HTMLDivElement>("#world-frame");
const connectionPill = requireElement<HTMLDivElement>("#connection-pill");
const connectionLabel = requireElement<HTMLSpanElement>("#connection-label");
const footerMode = requireElement<HTMLSpanElement>("#footer-mode");
const statusBadge = requireElement<HTMLSpanElement>("#status-badge");
const activityText = requireElement<HTMLSpanElement>("#activity-text");
const activityFeed = requireElement<HTMLOListElement>("#activity-feed");
const eventCount = requireElement<HTMLSpanElement>("#event-count");
const resultText = requireElement<HTMLParagraphElement>("#result-text");
const taskForm = requireElement<HTMLFormElement>("#task-form");
const taskPrompt = requireElement<HTMLTextAreaElement>("#task-prompt");
const runTaskButton = requireElement<HTMLButtonElement>("#run-task");
const runDemoButton = requireElement<HTMLButtonElement>("#run-demo");
const clearResultButton = requireElement<HTMLButtonElement>("#clear-result");
const taskHint = requireElement<HTMLParagraphElement>("#task-hint");
const doneBurst = requireElement<HTMLDivElement>("#done-burst");
const worldTitle = requireElement<HTMLHeadingElement>("#world-title");
const controlTitle = requireElement<HTMLHeadingElement>("#control-title");
const stationControls =
	requireElement<HTMLDivElement>(".station-controls");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#171629");

// Fixed internal resolution keeps the terrarium inexpensive to render.
const renderer = new THREE.WebGLRenderer({
	antialias: false,
	alpha: false,
	powerPreference: "low-power",
});
renderer.setSize(640, 360, false);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
worldFrame.prepend(renderer.domElement);

const camera = new THREE.OrthographicCamera(-5.33, 5.33, 3, -3, 0.1, 100);
camera.position.z = 10;

// Static scenery and moving agents are kept on separate scene branches.
const locationsRoot = new THREE.Group();
const teamAgentsRoot = new THREE.Group();
const mosinRoot = new THREE.Group();
scene.add(locationsRoot, teamAgentsRoot, mosinRoot);

const textureLoader = new THREE.TextureLoader();
let isMosinFacingLeft = false;

// One low-cost texture supplies all three rooms behind the animated sprites.
const homesteadBackgroundTexture = textureLoader.load(
	homesteadBackgroundUrl,
	renderScene,
);
homesteadBackgroundTexture.colorSpace = THREE.SRGBColorSpace;
homesteadBackgroundTexture.magFilter = THREE.NearestFilter;
homesteadBackgroundTexture.minFilter = THREE.NearestFilter;
homesteadBackgroundTexture.generateMipmaps = false;

const homesteadBackground = new THREE.Mesh(
	new THREE.PlaneGeometry(10.66, 6),
	new THREE.MeshBasicMaterial({ map: homesteadBackgroundTexture }),
);
homesteadBackground.position.z = -0.4;
locationsRoot.add(homesteadBackground);

function loadSpriteSheet(
	url: string,
	columns: number,
	rows: number,
): THREE.Texture {
	const texture = textureLoader.load(url, renderScene);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	texture.repeat.set(1 / columns, 1 / rows);
	texture.offset.set(0, 0);
	return texture;
}

function createAnimation({
	url,
	frameCount,
	columns,
	rows,
	displaySize,
	visualOffset,
	fps,
	loop,
}: AnimationOptions): AnimationDefinition {
	return {
		texture: loadSpriteSheet(url, columns, rows),
		frameCount,
		columns,
		rows,
		displaySize,
		visualOffset,
		fps,
		loop,
	};
}

const idleAnimation = createAnimation({
	url: mosinIdleUrl,
	frameCount: 4,
	columns: 4,
	rows: 1,
	displaySize: new THREE.Vector2(1.87, 2.8),
	visualOffset: new THREE.Vector2(0, -0.3),
	fps: 3,
	loop: true,
});

const mosinAnimations: Record<AgentStatus, AnimationDefinition> = {
	idle: idleAnimation,
	walking: createAnimation({
		url: mosinWalkingUrl,
		frameCount: 10,
		columns: 5,
		rows: 2,
		displaySize: new THREE.Vector2(1.8, 2.4),
		visualOffset: new THREE.Vector2(0, 0),
		fps: 10,
		loop: true,
	}),
	waiting: createAnimation({
		url: mosinWaitingUrl,
		frameCount: 4,
		columns: 4,
		rows: 1,
		displaySize: new THREE.Vector2(1.87, 2.8),
		visualOffset: new THREE.Vector2(0, -0.01),
		fps: 4,
		loop: true,
	}),
	working: createAnimation({
		url: mosinWorkingUrl,
		frameCount: 4,
		columns: 4,
		rows: 1,
		displaySize: new THREE.Vector2(1.87, 2.8),
		visualOffset: new THREE.Vector2(0, -0.27),
		fps: 8,
		loop: true,
	}),
	done: {
		...idleAnimation,
		fps: 8,
		loop: false,
	},
};

const statusMessages: Record<AgentStatus, string> = {
	idle: "Enjoying a quiet café break.",
	walking: "Marching across the homestead.",
	waiting: "Reviewing the plan at the maintenance table.",
	working: "Working through the task at the range.",
	done: "Task complete. Отличная работа!",
};

const statusLabels: Record<AgentStatus, string> = {
	idle: "IDLE",
	walking: "TRAVELLING",
	waiting: "PLANNING",
	working: "WORKING",
	done: "COMPLETE",
};

const destinations: Record<DestinationStatus, THREE.Vector3> = {
	idle: new THREE.Vector3(-3.55, -0.28, 2),
	waiting: new THREE.Vector3(0, -0.28, 2),
	working: new THREE.Vector3(3.55, -0.28, 2),
};

function makeMaterial(color: string, opacity = 1): THREE.MeshBasicMaterial {
	return new THREE.MeshBasicMaterial({
		color,
		transparent: opacity < 1,
		opacity,
	});
}

function createTextSprite(text: string, color: string): THREE.Sprite {
	const canvas = document.createElement("canvas");
	canvas.width = 384;
	canvas.height = 80;
	const context = canvas.getContext("2d");

	if (!context) {
		throw new Error("Could not create station label context");
	}

	context.imageSmoothingEnabled = false;
	context.fillStyle = "rgba(16, 15, 29, 0.88)";
	context.fillRect(2, 2, 380, 76);
	context.strokeStyle = color;
	context.lineWidth = 4;
	context.strokeRect(4, 4, 376, 72);
	context.fillStyle = "#fff9df";
	context.font = "700 28px ui-monospace, Consolas, monospace";
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.fillText(text, 192, 42);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;

	const sprite = new THREE.Sprite(
		new THREE.SpriteMaterial({ map: texture, transparent: true }),
	);
	sprite.scale.set(2.3, 0.48, 1);
	return sprite;
}

function createStation(
	position: THREE.Vector3,
	label: string,
	color: string,
): THREE.Group {
	const group = new THREE.Group();
	const pad = new THREE.Mesh(
		new THREE.PlaneGeometry(2.7, 2.6),
		makeMaterial("#11101c", 0.12),
	);
	pad.position.z = 0.05;

	// A thin outline identifies each destination without hiding the artwork.
	const borderGeometry = new THREE.BufferGeometry().setFromPoints([
		new THREE.Vector3(-1.42, -1.37, 0),
		new THREE.Vector3(1.42, -1.37, 0),
		new THREE.Vector3(1.42, 1.37, 0),
		new THREE.Vector3(-1.42, 1.37, 0),
	]);
	const border = new THREE.LineLoop(
		borderGeometry,
		new THREE.LineBasicMaterial({
			color,
			transparent: true,
			opacity: 0.78,
		}),
	);
	border.position.z = 0.25;

	const labelSprite = createTextSprite(label, color);
	labelSprite.position.set(0, 1.63, 1);

	const lanternGeometry = new THREE.PlaneGeometry(0.17, 0.32);
	const lanternMaterial = makeMaterial(color);
	const leftLantern = new THREE.Mesh(lanternGeometry, lanternMaterial);
	const rightLantern = new THREE.Mesh(lanternGeometry, lanternMaterial);
	leftLantern.position.set(-1.2, 1.08, 0.8);
	rightLantern.position.set(1.2, 1.08, 0.8);

	group.add(border, pad, labelSprite, leftLantern, rightLantern);
	group.position.set(position.x, position.y + 0.05, 0);
	return group;
}

locationsRoot.add(
	createStation(destinations.idle, "CAFÉ", "#d79b65"),
	createStation(destinations.waiting, "MAINTENANCE", "#8ac7be"),
	createStation(destinations.working, "WORK RANGE", "#d06e6e"),
);

const avatarPresetRows = new Map([
	["mosin", 0],
	["springfield", 1],
	["scout", 2],
	["engineer", 3],
	["medic", 4],
	["analyst", 5],
	["operator", 6],
	["commander", 7],
]);
const avatarWalkAtlasImage = new Image();
let avatarWalkAtlasReady = false;
let activeTeamVisuals: TeamVisual[] = [];
let currentTeamDestination: DestinationStatus = "idle";
let teamMovementFrame: number | null = null;
const teamAgentRuntimes = new Map<string, TeamAgentRuntime>();

function presetName(avatar: string): string | null {
	return avatar.startsWith("preset:") ? avatar.slice(7) : null;
}

function isMosinAgent(agent: TeamVisual): boolean {
	return (
		presetName(agent.avatar) === "mosin" ||
		agent.name.trim().toLowerCase() === "mosin"
	);
}

function presetAvatarTexture(agent: TeamVisual): THREE.CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 32;
	canvas.height = 32;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Could not create team avatar texture");
	}

	const palettes: Record<string, [string, string]> = {
		coordinator: ["#d79b65", "#34283d"],
		builder: ["#d06e6e", "#341f2b"],
		tester: ["#8ac7be", "#1c3237"],
		presenter: ["#a899d8", "#29243e"],
		general: ["#c0a95f", "#302d27"],
	};
	const [accent, base] = palettes[agent.role] ?? palettes.general;
	context.imageSmoothingEnabled = false;
	context.fillStyle = "#10101c";
	context.fillRect(0, 0, 32, 32);
	context.fillStyle = accent;
	context.fillRect(2, 2, 28, 28);
	context.fillStyle = base;
	context.fillRect(4, 4, 24, 24);
	context.fillStyle = accent;
	context.fillRect(8, 7, 16, 5);
	context.fillStyle = "#fff7dc";
	context.font = "700 11px ui-monospace, monospace";
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.fillText(
		agent.name
			.split(/\s+/)
			.map((part) => part[0])
			.join("")
			.slice(0, 2)
			.toUpperCase(),
		16,
		21,
	);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	return texture;
}

function createAvatarWalkTexture(agent: TeamVisual): {
	texture: THREE.Texture;
	animated: boolean;
} {
	const row = avatarPresetRows.get(presetName(agent.avatar) ?? "");
	if (
		row === undefined ||
		!avatarWalkAtlasReady ||
		avatarWalkAtlasImage.naturalWidth === 0
	) {
		return { texture: presetAvatarTexture(agent), animated: false };
	}

	// Each agent receives a tiny 128 × 32 row cut from the shared source atlas.
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 32;
	const context = canvas.getContext("2d");
	if (!context) {
		return { texture: presetAvatarTexture(agent), animated: false };
	}
	context.imageSmoothingEnabled = false;
	const sourceWidth = avatarWalkAtlasImage.naturalWidth / 4;
	const sourceHeight = avatarWalkAtlasImage.naturalHeight / 8;
	for (let frame = 0; frame < 4; frame += 1) {
		context.drawImage(
			avatarWalkAtlasImage,
			frame * sourceWidth,
			row * sourceHeight,
			sourceWidth,
			sourceHeight,
			frame * 32,
			0,
			32,
			32,
		);
	}

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	texture.repeat.set(1 / 4, 1);
	texture.offset.set(0, 0);
	return { texture, animated: true };
}

function teamWorldPosition(
	destination: DestinationStatus,
	index: number,
	hasMosin: boolean,
): THREE.Vector3 {
	const base = destinations[destination];
	const direction = destination === "working" ? -1 : 1;
	const slot = index + (hasMosin ? 1 : 0);
	return new THREE.Vector3(
		base.x + direction * slot * 0.72,
		-0.93,
		2.3 + index * 0.01,
	);
}

function setTeamFrame(runtime: TeamAgentRuntime, frame: number): void {
	runtime.frame = ((frame % 4) + 4) % 4;
	if (!runtime.animated) {
		return;
	}
	const frameWidth = 1 / 4;
	runtime.texture.repeat.x = runtime.facingLeft ? -frameWidth : frameWidth;
	runtime.texture.offset.x = runtime.facingLeft
		? runtime.frame * frameWidth + frameWidth
		: runtime.frame * frameWidth;
}

function syncTeamMarkerVisibility(): void {
	const hasMosin = activeTeamVisuals.some(isMosinAgent);
	for (const runtime of teamAgentRuntimes.values()) {
		const springfieldSharesCafe =
			presetName(runtime.agent.avatar) === "springfield" &&
			hasMosin &&
			(currentStatus === "idle" || currentStatus === "done") &&
			runtime.state === "idle" &&
			runtime.movement === null;
		runtime.root.visible = !springfieldSharesCafe;
	}
}

function animateTeamMovement(currentTime: number): void {
	let stillMoving = false;
	for (const runtime of teamAgentRuntimes.values()) {
		const movement = runtime.movement;
		if (!movement) {
			continue;
		}
		const progress = Math.min(
			(currentTime - movement.startedAt) / movement.duration,
			1,
		);
		const eased = 1 - (1 - progress) ** 3;
		runtime.root.position.lerpVectors(movement.from, movement.to, eased);
		if (progress < 1) {
			stillMoving = true;
			continue;
		}
		runtime.root.position.copy(movement.to);
		runtime.state = movement.arrivalState;
		runtime.facingLeft = false;
		runtime.movement = null;
		setTeamFrame(runtime, runtime.state === "waiting" ? 1 : 0);
	}
	syncTeamMarkerVisibility();
	renderScene();
	teamMovementFrame = stillMoving
		? requestAnimationFrame(animateTeamMovement)
		: null;
}

function moveTeamAgent(
	runtime: TeamAgentRuntime,
	target: THREE.Vector3,
	arrivalState: AgentStatus,
): void {
	const distance = runtime.root.position.distanceTo(target);
	if (distance < 0.02) {
		runtime.root.position.copy(target);
		runtime.state = arrivalState;
		runtime.movement = null;
		setTeamFrame(runtime, arrivalState === "waiting" ? 1 : 0);
		return;
	}
	runtime.facingLeft = target.x < runtime.root.position.x;
	runtime.state = "walking";
	runtime.movement = {
		from: runtime.root.position.clone(),
		to: target.clone(),
		startedAt: performance.now(),
		duration: Math.max(450, (distance / 3.4) * 1000),
		arrivalState,
	};
	if (teamMovementFrame === null) {
		teamMovementFrame = requestAnimationFrame(animateTeamMovement);
	}
}

function destinationForStage(stage: string): {
	destination: DestinationStatus;
	arrivalState: AgentStatus;
} {
	if (stage === "plan") {
		return { destination: "waiting", arrivalState: "waiting" };
	}
	if (stage === "build" || stage === "test") {
		return { destination: "working", arrivalState: "working" };
	}
	return { destination: "idle", arrivalState: "idle" };
}

function routeNonMosinTeam(
	destination: DestinationStatus,
	arrivalState: AgentStatus,
): void {
	currentTeamDestination = destination;
	const hasMosin = activeTeamVisuals.some(isMosinAgent);
	const runtimes = [...teamAgentRuntimes.values()];

	for (const [index, runtime] of runtimes.entries()) {
		moveTeamAgent(
			runtime,
			teamWorldPosition(destination, index, hasMosin),
			arrivalState,
		);
	}
	syncTeamMarkerVisibility();
}

function routeTeamForStage(stage: string): void {
	const { destination, arrivalState } = destinationForStage(stage);
	const hasMosin = activeTeamVisuals.some(isMosinAgent);
	if (hasMosin) {
		travelTo(destination, arrivalState);
	}
	routeNonMosinTeam(destination, arrivalState);
}

function routeTeamActivity(event: ActivityEvent): boolean {
	if (!event.agentId) {
		return false;
	}
	const runtime = teamAgentRuntimes.get(event.agentId);
	if (!runtime) {
		return false;
	}
	const { destination, arrivalState } = destinationForStage(event.stage ?? "");
	if (event.status === "walking") {
		currentTeamDestination = destination;
		const hasMosin = activeTeamVisuals.some(isMosinAgent);
		const runtimes = [...teamAgentRuntimes.values()];
		const index = Math.max(
			0,
			runtimes.findIndex((item) => item.agent.id === runtime.agent.id),
		);
		moveTeamAgent(
			runtime,
			teamWorldPosition(destination, index, hasMosin),
			arrivalState,
		);
	} else if (runtime.movement) {
		runtime.movement.arrivalState = event.status;
	} else {
		runtime.state = event.status;
		setTeamFrame(runtime, event.status === "waiting" ? 1 : 0);
	}
	syncTeamMarkerVisibility();
	renderScene();
	return true;
}

function renderTeamMarkers(agents: TeamVisual[]): void {
	activeTeamVisuals = agents;
	teamAgentsRoot.traverse((object) => {
		if (object instanceof THREE.Sprite) {
			object.material.map?.dispose();
			object.material.dispose();
		}
	});
	teamAgentsRoot.clear();
	teamAgentRuntimes.clear();
	const hasMosin = agents.some(isMosinAgent);
	mosinRoot.visible = hasMosin;
	const animatedAgents = agents
		.filter((agent) => !isMosinAgent(agent))
		.slice(0, 7);

	for (const [index, agent] of animatedAgents.entries()) {
		const { texture, animated } = createAvatarWalkTexture(agent);
		const material = new THREE.SpriteMaterial({
			map: texture,
			transparent: true,
		});
		const sprite = new THREE.Sprite(material);
		sprite.scale.set(1.48, 1.48, 1);
		const root = new THREE.Group();
		root.position.copy(
			teamWorldPosition(currentTeamDestination, index, hasMosin),
		);
		root.add(sprite);
		teamAgentsRoot.add(root);
		const runtime: TeamAgentRuntime = {
			agent,
			root,
			sprite,
			material,
			texture,
			animated,
			frame: 0,
			state: currentTeamDestination,
			facingLeft: false,
			movement: null,
		};
		teamAgentRuntimes.set(agent.id, runtime);
		setTeamFrame(runtime, 0);

		if (agent.avatar.startsWith("data:image/")) {
			textureLoader.load(agent.avatar, (uploadedTexture) => {
				uploadedTexture.colorSpace = THREE.SRGBColorSpace;
				uploadedTexture.magFilter = THREE.NearestFilter;
				uploadedTexture.minFilter = THREE.NearestFilter;
				uploadedTexture.generateMipmaps = false;
				material.map?.dispose();
				material.map = uploadedTexture;
				runtime.texture = uploadedTexture;
				runtime.animated = false;
				material.needsUpdate = true;
				renderScene();
			});
		}
	}
	syncTeamMarkerVisibility();
	renderScene();
}

window.setInterval(() => {
	const currentTick = Math.floor(performance.now() / 125);
	for (const runtime of teamAgentRuntimes.values()) {
		const shouldAnimate =
			runtime.state === "walking" || runtime.state === "working";
		if (shouldAnimate) {
			setTeamFrame(runtime, currentTick % 4);
		} else if (runtime.state === "waiting") {
			setTeamFrame(runtime, 1);
		} else {
			setTeamFrame(runtime, 0);
		}
		runtime.sprite.position.y =
			shouldAnimate && currentTick % 2 === 0 ? 0.025 : 0;
	}
	renderScene();
}, 125);

avatarWalkAtlasImage.onload = () => {
	avatarWalkAtlasReady = true;
	renderTeamMarkers(activeTeamVisuals);
};
avatarWalkAtlasImage.src = avatarWalkAtlasUrl;

window.addEventListener("homestead:team", (event) => {
	const detail = (
		event as CustomEvent<{ agents: TeamVisual[]; leadAgentId: string }>
	).detail;
	const leadAgent =
		detail.agents.find((agent) => agent.id === detail.leadAgentId) ??
		detail.agents[0];
	const leadName = leadAgent?.name ?? "Agent";
	worldTitle.textContent = `${leadName}'s Workday`;
	controlTitle.textContent = `Give ${leadName} a task`;
	stationControls.setAttribute(
		"aria-label",
		`Send ${leadName} and the team to a location`,
	);
	renderTeamMarkers(detail.agents);
});

const mosinMaterial = new THREE.SpriteMaterial({
	map: mosinAnimations.idle.texture,
	transparent: true,
});
const mosinSprite = new THREE.Sprite(mosinMaterial);
mosinRoot.add(mosinSprite);
mosinRoot.position.copy(destinations.idle);

let currentStatus: AgentStatus = "idle";
let spriteFrameIndex = 0;
let spriteAnimationTimer: number | null = null;
let movementFrame: number | null = null;
let movementTarget: DestinationStatus | null = null;
let movementArrivalStatus: AgentStatus = "idle";
let demoTimers: number[] = [];
let connectionMode: ConnectionMode = "connecting";
let activityEventCount = 0;

function renderScene(): void {
	renderer.render(scene, camera);
}

function showFrame(animation: AnimationDefinition, frameIndex: number): void {
	const safeIndex =
		((frameIndex % animation.frameCount) + animation.frameCount) %
		animation.frameCount;
	const column = safeIndex % animation.columns;
	const row = Math.floor(safeIndex / animation.columns);
	const frameWidth = 1 / animation.columns;
	const frameHeight = 1 / animation.rows;
	const frameStartX = column * frameWidth;

	animation.texture.repeat.x = isMosinFacingLeft ? -frameWidth : frameWidth;
	animation.texture.repeat.y = frameHeight;
	animation.texture.offset.x = isMosinFacingLeft
		? frameStartX + frameWidth
		: frameStartX;
	animation.texture.offset.y = 1 - (row + 1) * frameHeight;
	renderScene();
}

function stopSpriteAnimation(): void {
	if (spriteAnimationTimer === null) {
		return;
	}

	window.clearInterval(spriteAnimationTimer);
	spriteAnimationTimer = null;
}

function playMosinAnimation(status: AgentStatus): void {
	stopSpriteAnimation();
	const animation = mosinAnimations[status];
	mosinSprite.scale.set(animation.displaySize.x, animation.displaySize.y, 1);
	mosinSprite.position.set(
		animation.visualOffset.x,
		animation.visualOffset.y,
		0,
	);
	mosinMaterial.map = animation.texture;
	mosinMaterial.needsUpdate = true;
	spriteFrameIndex = 0;
	showFrame(animation, spriteFrameIndex);

	spriteAnimationTimer = window.setInterval(() => {
		const nextFrame = spriteFrameIndex + 1;

		if (nextFrame >= animation.frameCount && !animation.loop) {
			stopSpriteAnimation();
			return;
		}

		spriteFrameIndex = nextFrame % animation.frameCount;
		showFrame(animation, spriteFrameIndex);
	}, 1000 / animation.fps);
}

function updateStatus(status: AgentStatus, message?: string): void {
	currentStatus = status;
	statusBadge.textContent = statusLabels[status];
	statusBadge.dataset.status = status;
	activityText.textContent = message ?? statusMessages[status];
	doneBurst.classList.toggle("is-visible", status === "done");
	playMosinAnimation(status);
	syncTeamMarkerVisibility();
}

function cancelMovement(): void {
	if (movementFrame !== null) {
		cancelAnimationFrame(movementFrame);
		movementFrame = null;
	}
	movementTarget = null;
}

function travelTo(
	destinationStatus: DestinationStatus,
	arrivalStatus: AgentStatus = destinationStatus,
	message?: string,
): void {
	if (movementFrame !== null && movementTarget === destinationStatus) {
		movementArrivalStatus = arrivalStatus;
		if (message) {
			activityText.textContent = message;
		}
		return;
	}

	cancelMovement();
	const destination = destinations[destinationStatus];
	const startingPosition = mosinRoot.position.clone();
	const distance = startingPosition.distanceTo(destination);

	if (distance < 0.02) {
		isMosinFacingLeft = false;
		updateStatus(arrivalStatus, message);
		return;
	}

	movementTarget = destinationStatus;
	movementArrivalStatus = arrivalStatus;
	isMosinFacingLeft = destination.x < startingPosition.x;
	updateStatus("walking", message ?? statusMessages.walking);

	const duration = Math.max(500, (distance / 3.8) * 1000);
	const startedAt = performance.now();

	function animate(currentTime: number): void {
		const progress = Math.min((currentTime - startedAt) / duration, 1);
		const easedProgress = 1 - (1 - progress) ** 3;
		mosinRoot.position.lerpVectors(
			startingPosition,
			destination,
			easedProgress,
		);
		renderScene();

		if (progress < 1) {
			movementFrame = requestAnimationFrame(animate);
			return;
		}

		movementFrame = null;
		movementTarget = null;
		isMosinFacingLeft = false;
		updateStatus(movementArrivalStatus, message);
	}

	movementFrame = requestAnimationFrame(animate);
}

function routeAgent(status: AgentStatus, message?: string): void {
	switch (status) {
		case "idle":
			travelTo("idle", "idle", message);
			break;
		case "waiting":
			travelTo("waiting", "waiting", message);
			break;
		case "working":
			travelTo("working", "working", message);
			break;
		case "walking":
			updateStatus("walking", message);
			break;
		case "done":
			cancelMovement();
			updateStatus("done", message);
			break;
	}
}

function setConnection(mode: ConnectionMode, message: string): void {
	connectionMode = mode;
	connectionPill.className = `connection-pill is-${mode}`;
	connectionLabel.textContent = message;
	footerMode.textContent =
		mode === "live"
			? "Codex app-server connected locally"
			: mode === "connecting"
				? "Connecting to local bridge…"
				: "Demo mode · Codex bridge unavailable";
	runTaskButton.disabled = mode !== "live";
	taskHint.textContent =
		mode === "live"
			? "Connected locally in read-only mode. No browser API key is used."
			: "Codex is unavailable, but the animation demo remains fully usable.";
}

function addActivity(message: string, kind = "info"): void {
	activityEventCount += 1;
	eventCount.textContent = `${activityEventCount} ${
		activityEventCount === 1 ? "event" : "events"
	}`;

	const item = document.createElement("li");
	item.dataset.kind = kind;
	const time = document.createElement("time");
	time.dateTime = new Date().toISOString();
	time.textContent = new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).format(new Date());
	const text = document.createElement("span");
	text.textContent = message;
	item.append(time, text);
	activityFeed.prepend(item);

	while (activityFeed.children.length > 8) {
		activityFeed.lastElementChild?.remove();
	}
}

function clearDemoTimers(): void {
	for (const timer of demoTimers) {
		window.clearTimeout(timer);
	}
	demoTimers = [];
}

function queueDemoStep(delay: number, action: () => void): void {
	demoTimers.push(window.setTimeout(action, delay));
}

function runDemo(): void {
	clearDemoTimers();
	addActivity("Demo chore accepted.", "task");
	travelTo("waiting", "waiting", "Reviewing the chore list.");
	queueDemoStep(2600, () => {
		addActivity("Plan ready. Moving to the work range.", "plan");
		travelTo("working", "working", "Testing the homestead systems.");
	});
	queueDemoStep(6200, () => {
		addActivity("Demo chore completed.", "success");
		routeAgent("done", "Demo task complete. Молодец!");
	});
	queueDemoStep(8300, () => {
		routeAgent("idle", "Returning to the café.");
	});
}

function handleBridgeEvent(event: BridgeEvent): void {
	window.dispatchEvent(
		new CustomEvent("homestead:bridge", { detail: event }),
	);

	switch (event.type) {
		case "connection":
			setConnection(event.mode, event.message);
			addActivity(event.message, event.mode);
			break;
		case "activity":
			if (!routeTeamActivity(event)) {
				routeAgent(event.status, event.message);
			} else {
				statusBadge.textContent = statusLabels[event.status];
				statusBadge.dataset.status = event.status;
				activityText.textContent = event.message;
			}
			addActivity(event.message, event.status);
			break;
		case "workflow": {
			const action = String(event.action ?? "");
			if (action === "stage-started") {
				routeTeamForStage(String(event.stage ?? "chat"));
			}
			if (action === "completed" || action === "failed") {
				routeTeamForStage("chat");
			}
			break;
		}
		case "log":
			addActivity(event.message, event.kind ?? "info");
			break;
		case "result":
			resultText.textContent = event.text;
			break;
		default:
			break;
	}
}

async function readBridgeStatus(): Promise<void> {
	try {
		const response = await fetch("/api/status", {
			headers: { Accept: "application/json" },
		});

		if (!response.ok) {
			throw new Error(`Bridge status ${response.status}`);
		}

		const status = (await response.json()) as {
			mode: ConnectionMode;
			message: string;
		};
		setConnection(status.mode, status.message);
	} catch {
		setConnection("demo", "Demo mode");
		addActivity("Local Codex bridge was not detected.", "offline");
	}
}

function connectEventStream(): void {
	const events = new EventSource("/api/events");

	events.addEventListener("homestead", (rawEvent) => {
		const messageEvent = rawEvent as MessageEvent<string>;

		try {
			handleBridgeEvent(JSON.parse(messageEvent.data) as BridgeEvent);
		} catch {
			addActivity("Received an unreadable bridge event.", "error");
		}
	});

	events.onerror = () => {
		if (connectionMode === "live" || connectionMode === "connecting") {
			setConnection("offline", "Bridge reconnecting…");
		}
	};
}

taskForm.addEventListener("submit", async (event) => {
	if (taskForm.dataset.studioReady === "true") {
		return;
	}
	event.preventDefault();
	const prompt = taskPrompt.value.trim();

	if (prompt.length < 3) {
		taskHint.textContent = "Enter a short task before sending Mosin to work.";
		taskPrompt.focus();
		return;
	}

	runTaskButton.disabled = true;
	addActivity("Sending task to local Codex…", "task");

	try {
		const response = await fetch("/api/tasks", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt }),
		});
		const payload = (await response.json()) as { error?: string };

		if (!response.ok) {
			throw new Error(payload.error ?? `Request failed (${response.status})`);
		}

		taskPrompt.value = "";
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Could not start the Codex task";
		addActivity(message, "error");
		taskHint.textContent = `${message}. Demo mode is still available.`;
	}

	runTaskButton.disabled = connectionMode !== "live";
});

taskPrompt.addEventListener("keydown", (event) => {
	if (taskForm.dataset.studioReady === "true") {
		return;
	}
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		taskForm.requestSubmit();
	}
});

runDemoButton.addEventListener("click", runDemo);
clearResultButton.addEventListener("click", () => {
	resultText.textContent = "No completed Codex task yet.";
});

document
	.querySelectorAll<HTMLButtonElement>("[data-destination]")
	.forEach((button) => {
		button.addEventListener("click", () => {
			const destination = button.dataset.destination;

			if (
				destination === "idle" ||
				destination === "waiting" ||
				destination === "working"
			) {
				clearDemoTimers();
				travelTo(destination);
				routeNonMosinTeam(destination, destination);
				addActivity(
					`Manual route: ${button.textContent?.trim() ?? destination}.`,
				);
			}
		});
	});

playMosinAnimation(currentStatus);
renderScene();
setConnection("connecting", "Connecting to Codex…");
void readBridgeStatus();
connectEventStream();
void initStudio({
	taskForm,
	taskPrompt,
	runTaskButton,
	taskHint,
	resultText,
	addActivity,
}).catch((error) => {
	const message =
		error instanceof Error ? error.message : "Could not initialize the studio";
	addActivity(message, "error");
	taskHint.textContent = `${message}. The basic Homestead view is still available.`;
});
