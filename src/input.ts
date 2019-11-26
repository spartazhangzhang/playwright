// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { assert } from './helper';
import * as keyboardLayout from './USKeyboardLayout';

export type Modifier = 'Alt' | 'Control' | 'Meta' | 'Shift';
export type Button = 'left' | 'right' | 'middle';

type Point = {
  x: number;
  y: number;
};

export type PointerActionOptions = {
  modifiers?: Modifier[];
  relativePoint?: Point;
};

export type ClickOptions = PointerActionOptions & {
  delay?: number;
  button?: Button;
  clickCount?: number;
};

export type MultiClickOptions = PointerActionOptions & {
  delay?: number;
  button?: Button;
};

export type SelectOption = {
  value?: string;
  label?: string;
  index?: number;
};

export const keypadLocation = keyboardLayout.keypadLocation;

type KeyDescription = {
  keyCode: number,
  key: string,
  text: string,
  code: string,
  location: number,
};

const kModifiers: Modifier[] = ['Alt', 'Control', 'Meta', 'Shift'];

export interface RawKeyboard {
  keydown(modifiers: Set<Modifier>, code: string, keyCode: number, key: string, location: number, autoRepeat: boolean, text: string | undefined): Promise<void>;
  keyup(modifiers: Set<Modifier>, code: string, keyCode: number, key: string, location: number): Promise<void>;
  sendText(text: string): Promise<void>;
}

export class Keyboard {
  private _raw: RawKeyboard;
  private _pressedModifiers = new Set<Modifier>();
  private _pressedKeys = new Set<string>();

  constructor(raw: RawKeyboard) {
    this._raw = raw;
  }

  async down(key: string, options: { text?: string; } = { text: undefined }) {
    const description = this._keyDescriptionForString(key);
    const autoRepeat = this._pressedKeys.has(description.code);
    this._pressedKeys.add(description.code);
    if (kModifiers.includes(description.key as Modifier))
      this._pressedModifiers.add(description.key as Modifier);
    const text = options.text === undefined ? description.text : options.text;
    await this._raw.keydown(this._pressedModifiers, description.code, description.keyCode, description.key, description.location, autoRepeat, text);
  }

  private _keyDescriptionForString(keyString: string): KeyDescription {
    const shift = this._pressedModifiers.has('Shift');
    const description: KeyDescription = {
      key: '',
      keyCode: 0,
      code: '',
      text: '',
      location: 0
    };

    const definition = keyboardLayout.keyDefinitions[keyString];
    assert(definition, `Unknown key: "${keyString}"`);

    if (definition.key)
      description.key = definition.key;
    if (shift && definition.shiftKey)
      description.key = definition.shiftKey;

    if (definition.keyCode)
      description.keyCode = definition.keyCode;
    if (shift && definition.shiftKeyCode)
      description.keyCode = definition.shiftKeyCode;

    if (definition.code)
      description.code = definition.code;

    if (definition.location)
      description.location = definition.location;

    if (description.key.length === 1)
      description.text = description.key;

    if (definition.text)
      description.text = definition.text;
    if (shift && definition.shiftText)
      description.text = definition.shiftText;

    // if any modifiers besides shift are pressed, no text should be sent
    if (this._pressedModifiers.size > 1 || (!this._pressedModifiers.has('Shift') && this._pressedModifiers.size === 1))
      description.text = '';

    return description;
  }

  async up(key: string) {
    const description = this._keyDescriptionForString(key);
    if (kModifiers.includes(description.key as Modifier))
      this._pressedModifiers.delete(description.key as Modifier);
    this._pressedKeys.delete(description.code);
    await this._raw.keyup(this._pressedModifiers, description.code, description.keyCode, description.key, description.location);
  }

  async sendCharacter(text: string) {
    await this._raw.sendText(text);
  }

  async type(text: string, options: { delay: (number | undefined); } | undefined) {
    const delay = (options && options.delay) || null;
    for (const char of text) {
      if (keyboardLayout.keyDefinitions[char]) {
        await this.press(char, {delay});
      } else {
        if (delay)
          await new Promise(f => setTimeout(f, delay));
        await this.sendCharacter(char);
      }
    }
  }

  async press(key: string, options: { delay?: number; text?: string; } = {}) {
    const {delay = null} = options;
    await this.down(key, options);
    if (delay)
      await new Promise(f => setTimeout(f, options.delay));
    await this.up(key);
  }

  async _ensureModifiers(modifiers: Modifier[]): Promise<Modifier[]> {
    for (const modifier of modifiers) {
      if (!kModifiers.includes(modifier))
        throw new Error('Uknown modifier ' + modifier);
    }
    const restore: Modifier[] = Array.from(this._pressedModifiers);
    const promises: Promise<void>[] = [];
    for (const key of kModifiers) {
      const needDown = modifiers.includes(key);
      const isDown = this._pressedModifiers.has(key);
      if (needDown && !isDown)
        promises.push(this.down(key));
      else if (!needDown && isDown)
        promises.push(this.up(key));
    }
    await Promise.all(promises);
    return restore;
  }

  _modifiers(): Set<Modifier> {
    return this._pressedModifiers;
  }
}

export interface RawMouse {
  move(x: number, y: number, button: Button | 'none', buttons: Set<Button>, modifiers: Set<Modifier>): Promise<void>;
  down(x: number, y: number, button: Button, buttons: Set<Button>, modifiers: Set<Modifier>, clickCount: number): Promise<void>;
  up(x: number, y: number, button: Button, buttons: Set<Button>, modifiers: Set<Modifier>, clickCount: number): Promise<void>;
}

export class Mouse {
  private _raw: RawMouse;
  private _keyboard: Keyboard;
  private _x = 0;
  private _y = 0;
  private _lastButton: 'none' | Button = 'none';
  private _buttons = new Set<Button>();

  constructor(raw: RawMouse, keyboard: Keyboard) {
    this._raw = raw;
    this._keyboard = keyboard;
  }

  async move(x: number, y: number, options: { steps?: number } = {}) {
    const { steps = 1 } = options;
    const fromX = this._x;
    const fromY = this._y;
    this._x = x;
    this._y = y;
    for (let i = 1; i <= steps; i++) {
      const middleX = fromX + (x - fromX) * (i / steps);
      const middleY = fromY + (y - fromY) * (i / steps);
      await this._raw.move(middleX, middleY, this._lastButton, this._buttons, this._keyboard._modifiers());
    }
  }

  async down(options: { button?: Button, clickCount?: number } = {}) {
    const { button = 'left', clickCount = 1 } = options;
    this._lastButton = button;
    this._buttons.add(button);
    await this._raw.down(this._x, this._y, this._lastButton, this._buttons, this._keyboard._modifiers(), clickCount);
  }

  async up(options: { button?: Button, clickCount?: number } = {}) {
    const { button = 'left', clickCount = 1 } = options;
    this._lastButton = 'none';
    this._buttons.delete(button);
    await this._raw.up(this._x, this._y, button, this._buttons, this._keyboard._modifiers(), clickCount);
  }

  async click(x: number, y: number, options: ClickOptions = {}) {
    const {delay = null} = options;
    if (delay !== null) {
      await Promise.all([
        this.move(x, y),
        this.down(options),
      ]);
      await new Promise(f => setTimeout(f, delay));
      await this.up(options);
    } else {
      await Promise.all([
        this.move(x, y),
        this.down(options),
        this.up(options),
      ]);
    }
  }

  async dblclick(x: number, y: number, options: MultiClickOptions = {}) {
    const { delay = null } = options;
    if (delay !== null) {
      await this.move(x, y);
      await this.down({ ...options, clickCount: 1 });
      await new Promise(f => setTimeout(f, delay));
      await this.up({ ...options, clickCount: 1 });
      await new Promise(f => setTimeout(f, delay));
      await this.down({ ...options, clickCount: 2 });
      await new Promise(f => setTimeout(f, delay));
      await this.up({ ...options, clickCount: 2 });
    } else {
      await Promise.all([
        this.move(x, y),
        this.down({ ...options, clickCount: 1 }),
        this.up({ ...options, clickCount: 1 }),
        this.down({ ...options, clickCount: 2 }),
        this.up({ ...options, clickCount: 2 }),
      ]);
    }
  }

  async tripleclick(x: number, y: number, options: MultiClickOptions = {}) {
    const { delay = null } = options;
    if (delay !== null) {
      await this.move(x, y);
      await this.down({ ...options, clickCount: 1 });
      await new Promise(f => setTimeout(f, delay));
      await this.up({ ...options, clickCount: 1 });
      await new Promise(f => setTimeout(f, delay));
      await this.down({ ...options, clickCount: 2 });
      await new Promise(f => setTimeout(f, delay));
      await this.up({ ...options, clickCount: 2 });
      await new Promise(f => setTimeout(f, delay));
      await this.down({ ...options, clickCount: 3 });
      await new Promise(f => setTimeout(f, delay));
      await this.up({ ...options, clickCount: 3 });
    } else {
      await Promise.all([
        this.move(x, y),
        this.down({ ...options, clickCount: 1 }),
        this.up({ ...options, clickCount: 1 }),
        this.down({ ...options, clickCount: 2 }),
        this.up({ ...options, clickCount: 2 }),
        this.down({ ...options, clickCount: 3 }),
        this.up({ ...options, clickCount: 3 }),
      ]);
    }
  }
}

export const selectFunction = (element: HTMLSelectElement, ...optionsToSelect: (Node | SelectOption)[]) => {
  if (element.nodeName.toLowerCase() !== 'select')
    throw new Error('Element is not a <select> element.');

  const options = Array.from(element.options);
  element.value = undefined;
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    option.selected = optionsToSelect.some(optionToSelect => {
      if (optionToSelect instanceof Node)
        return option === optionToSelect;
      let matches = true;
      if (optionToSelect.value !== undefined)
        matches = matches && optionToSelect.value === option.value;
      if (optionToSelect.label !== undefined)
        matches = matches && optionToSelect.label === option.label;
      if (optionToSelect.index !== undefined)
        matches = matches && optionToSelect.index === index;
      return matches;
    });
    if (option.selected && !element.multiple)
      break;
  }
  element.dispatchEvent(new Event('input', { 'bubbles': true }));
  element.dispatchEvent(new Event('change', { 'bubbles': true }));
  return options.filter(option => option.selected).map(option => option.value);
};

export const fillFunction = (element: HTMLElement) => {
  if (element.nodeType !== Node.ELEMENT_NODE)
    return 'Node is not of type HTMLElement';
  if (element.nodeName.toLowerCase() === 'input') {
    const input = element as HTMLInputElement;
    const type = input.getAttribute('type') || '';
    const kTextInputTypes = new Set(['', 'password', 'search', 'tel', 'text', 'url']);
    if (!kTextInputTypes.has(type.toLowerCase()))
      return 'Cannot fill input of type "' + type + '".';
    input.selectionStart = 0;
    input.selectionEnd = input.value.length;
  } else if (element.nodeName.toLowerCase() === 'textarea') {
    const textarea = element as HTMLTextAreaElement;
    textarea.selectionStart = 0;
    textarea.selectionEnd = textarea.value.length;
  } else if (element.isContentEditable) {
    if (!element.ownerDocument || !element.ownerDocument.defaultView)
      return 'Element does not belong to a window';
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    const selection = element.ownerDocument.defaultView.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    return 'Element is not an <input>, <textarea> or [contenteditable] element.';
  }
  return false;
};

export const mediaTypes = new Set(['screen', 'print']);
export const mediaColorSchemes = new Set(['dark', 'light', 'no-preference']);