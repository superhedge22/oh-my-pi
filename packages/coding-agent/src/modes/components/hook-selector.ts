/**
 * Generic selector component for hooks.
 * Displays a list of string options with keyboard navigation.
 */
import {
	Container,
	Markdown,
	matchesKey,
	padding,
	renderInlineMarkdown,
	replaceTabs,
	Spacer,
	Text,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import { getMarkdownTheme, theme } from "../../modes/theme/theme";
import { matchesAppExternalEditor, matchesSelectCancel } from "../../modes/utils/keybinding-matchers";
import { CountdownTimer } from "./countdown-timer";
import { DynamicBorder } from "./dynamic-border";

export interface HookSelectorOptions {
	tui?: TUI;
	timeout?: number;
	onTimeout?: () => void;
	initialIndex?: number;
	outline?: boolean;
	maxVisible?: number;
	onLeft?: () => void;
	onRight?: () => void;
	onExternalEditor?: () => void;
	helpText?: string;
	disabledIndices?: readonly number[];
}

class OutlinedList extends Container {
	#lines: string[] = [];

	setLines(lines: string[]): void {
		this.#lines = lines;
		this.invalidate();
	}

	render(width: number): string[] {
		const borderColor = (text: string) => theme.fg("border", text);
		const horizontal = borderColor(theme.boxSharp.horizontal.repeat(Math.max(1, width)));
		const innerWidth = Math.max(1, width - 2);
		const content = this.#lines.map(line => {
			const normalized = replaceTabs(line);
			const fitted = truncateToWidth(normalized, innerWidth);
			const pad = Math.max(0, innerWidth - visibleWidth(fitted));
			return `${borderColor(theme.boxSharp.vertical)}${fitted}${padding(pad)}${borderColor(theme.boxSharp.vertical)}`;
		});
		return [horizontal, ...content, horizontal];
	}
}

export class HookSelectorComponent extends Container {
	#options: string[];
	#selectedIndex: number;
	#disabledIndices: Set<number>;
	#maxVisible: number;
	#listContainer: Container | undefined;
	#outlinedList: OutlinedList | undefined;
	#onSelectCallback: (option: string) => void;
	#onCancelCallback: () => void;
	#titleComponent: Markdown;
	#baseTitle: string;
	#countdown: CountdownTimer | undefined;
	#onLeftCallback: (() => void) | undefined;
	#onRightCallback: (() => void) | undefined;
	#onExternalEditorCallback: (() => void) | undefined;
	constructor(
		title: string,
		options: string[],
		onSelect: (option: string) => void,
		onCancel: () => void,
		opts?: HookSelectorOptions,
	) {
		super();

		this.#options = options;
		this.#disabledIndices = new Set(
			(opts?.disabledIndices ?? []).filter(index => Number.isInteger(index) && index >= 0 && index < options.length),
		);
		this.#selectedIndex = this.#coerceSelectedIndex(opts?.initialIndex ?? 0);
		this.#maxVisible = Math.max(3, opts?.maxVisible ?? 12);
		this.#onSelectCallback = onSelect;
		this.#onCancelCallback = onCancel;
		this.#baseTitle = title;
		this.#onLeftCallback = opts?.onLeft;
		this.#onRightCallback = opts?.onRight;
		this.#onExternalEditorCallback = opts?.onExternalEditor;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		this.#titleComponent = new Markdown(title, 1, 0, getMarkdownTheme(), { color: t => theme.fg("accent", t) });
		this.addChild(this.#titleComponent);
		this.addChild(new Spacer(1));

		if (opts?.timeout && opts.timeout > 0 && opts.tui) {
			this.#countdown = new CountdownTimer(
				opts.timeout,
				opts.tui,
				s => this.#titleComponent.setText(`${this.#baseTitle} (${s}s)`),
				() => {
					opts?.onTimeout?.();
					// Auto-select current option on timeout (typically the first/recommended option)
					const selected = this.#options[this.#selectedIndex];
					if (selected && !this.#isDisabled(this.#selectedIndex)) {
						this.#onSelectCallback(selected);
					} else {
						this.#onCancelCallback();
					}
				},
			);
		}

		if (opts?.outline) {
			this.#outlinedList = new OutlinedList();
			this.addChild(this.#outlinedList);
		} else {
			this.#listContainer = new Container();
			this.addChild(this.#listContainer);
		}
		this.addChild(new Spacer(1));
		const controlsHint = opts?.helpText ?? "up/down navigate  enter select  esc cancel";
		this.addChild(new Text(theme.fg("dim", controlsHint), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.#updateList();
	}

	#isDisabled(index: number): boolean {
		return this.#disabledIndices.has(index);
	}

	#coerceSelectedIndex(index: number): number {
		if (this.#options.length === 0) return -1;
		const maxIndex = this.#options.length - 1;
		const clamped = Math.max(0, Math.min(index, maxIndex));
		if (!this.#isDisabled(clamped)) return clamped;
		for (let i = clamped + 1; i <= maxIndex; i++) {
			if (!this.#isDisabled(i)) return i;
		}
		for (let i = clamped - 1; i >= 0; i--) {
			if (!this.#isDisabled(i)) return i;
		}
		return clamped;
	}

	#moveSelection(delta: number): void {
		if (this.#options.length === 0) return;
		const maxIndex = this.#options.length - 1;
		let index = this.#selectedIndex;
		while (true) {
			const next = Math.max(0, Math.min(index + delta, maxIndex));
			if (next === index) return;
			index = next;
			if (!this.#isDisabled(index)) {
				this.#selectedIndex = index;
				this.#updateList();
				return;
			}
		}
	}

	#updateList(): void {
		const lines: string[] = [];
		const startIndex = Math.max(
			0,
			Math.min(this.#selectedIndex - Math.floor(this.#maxVisible / 2), this.#options.length - this.#maxVisible),
		);
		const endIndex = Math.min(startIndex + this.#maxVisible, this.#options.length);

		const mdTheme = getMarkdownTheme();
		for (let i = startIndex; i < endIndex; i++) {
			const isSelected = i === this.#selectedIndex;
			const isDisabled = this.#isDisabled(i);
			const textColor = isDisabled ? "dim" : isSelected ? "accent" : "text";
			const prefixColor = isDisabled ? "dim" : "accent";
			const label = renderInlineMarkdown(this.#options[i], mdTheme, t => theme.fg(textColor, t));
			const prefix = isSelected ? theme.fg(prefixColor, `${theme.nav.cursor} `) : "  ";
			lines.push(prefix + label);
		}

		if (startIndex > 0 || endIndex < this.#options.length) {
			lines.push(theme.fg("dim", `  (${this.#selectedIndex + 1}/${this.#options.length})`));
		}
		if (this.#outlinedList) {
			this.#outlinedList.setLines(lines);
			return;
		}
		this.#listContainer?.clear();
		for (const line of lines) {
			this.#listContainer?.addChild(new Text(line, 1, 0));
		}
	}

	handleInput(keyData: string): void {
		// Reset countdown on any interaction
		this.#countdown?.reset();

		if (matchesKey(keyData, "up") || keyData === "k") {
			this.#moveSelection(-1);
		} else if (matchesKey(keyData, "down") || keyData === "j") {
			this.#moveSelection(1);
		} else if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			const selected = this.#options[this.#selectedIndex];
			if (selected && !this.#isDisabled(this.#selectedIndex)) this.#onSelectCallback(selected);
		} else if (matchesKey(keyData, "left")) {
			this.#onLeftCallback?.();
		} else if (matchesKey(keyData, "right")) {
			this.#onRightCallback?.();
		} else if (this.#onExternalEditorCallback && matchesAppExternalEditor(keyData)) {
			this.#onExternalEditorCallback();
		} else if (matchesSelectCancel(keyData)) {
			this.#onCancelCallback();
		}
	}

	dispose(): void {
		this.#countdown?.dispose();
	}
}
