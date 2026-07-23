export const avatarPresets = [
	"mosin",
	"springfield",
	"scout",
	"engineer",
	"medic",
	"analyst",
	"operator",
	"commander",
] as const;

export const avatarPresetRows = new Map<string, number>(
	avatarPresets.map((preset, row) => [preset, row]),
);

// Rows 1–5 contain disconnected fragments from the character above them.
// These values remove only that contaminated top strip.
export const avatarRowTopTrim = [0, 27, 27, 23, 21, 16, 0, 0] as const;

export function avatarRowPosition(row: number): string {
	return `${(row / (avatarPresets.length - 1)) * 100}%`;
}

export function avatarTopTrim(row: number): string {
	return `${((avatarRowTopTrim[row] ?? 0) / 224) * 100}%`;
}
