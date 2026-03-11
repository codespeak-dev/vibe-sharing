/**
 * Custom checkbox prompt with animated goose.
 * Based on @inquirer/checkbox, with goose ASCII art rendered alongside.
 */
import {
  createPrompt,
  useState,
  useKeypress,
  usePrefix,
  usePagination,
  useMemo,
  makeTheme,
  isUpKey,
  isDownKey,
  isSpaceKey,
  isNumberKey,
  isEnterKey,
  Separator,
  ValidationError,
} from "@inquirer/core";
import type { Theme, Status } from "@inquirer/core";
import { cursorHide } from "@inquirer/ansi";
import colors from "yoctocolors-cjs";
import figures from "@inquirer/figures";
import { renderWithGoose, GOOSE_FRAMES } from "./goose.js";

type CheckboxTheme = {
  icon: {
    checked: string;
    unchecked: string;
    cursor: string;
  };
  style: {
    disabledChoice: (text: string) => string;
    renderSelectedChoices: <T>(
      choices: ReadonlyArray<NormalizedChoice<T>>,
      allChoices: ReadonlyArray<NormalizedChoice<T> | Separator>,
    ) => string;
    description: (text: string) => string;
    keysHelpTip: (keys: ReadonlyArray<[string, string]>) => string;
  };
  helpMode: "always" | "never" | "auto";
  keybindings: ReadonlyArray<"emacs" | "vim">;
};

const checkboxTheme: CheckboxTheme = {
  icon: {
    checked: colors.green(figures.circleFilled),
    unchecked: figures.circle,
    cursor: figures.pointer,
  },
  style: {
    disabledChoice: (text: string) => colors.dim(`- ${text}`),
    renderSelectedChoices: (selectedChoices) =>
      selectedChoices.map((choice) => choice.short).join(", "),
    description: (text: string) => colors.cyan(text),
    keysHelpTip: (keys) =>
      keys
        .map(([key, action]) => `${colors.bold(key)} ${colors.dim(action)}`)
        .join(colors.dim(" • ")),
  },
  helpMode: "always",
  keybindings: [],
};

type Choice<Value> = {
  value: Value;
  name?: string;
  short?: string;
  checkedName?: string;
  description?: string;
  disabled?: boolean | string;
  checked?: boolean;
};

type NormalizedChoice<Value> = {
  value: Value;
  name: string;
  short: string;
  checkedName: string;
  description?: string;
  disabled: boolean | string;
  checked: boolean;
};

type Config<Value> = {
  message: string;
  choices: ReadonlyArray<Choice<Value> | Separator>;
  pageSize?: number;
  loop?: boolean;
  required?: boolean;
  validate?: (
    choices: ReadonlyArray<NormalizedChoice<Value>>,
  ) => boolean | string | Promise<boolean | string>;
  instructions?: string | boolean;
  shortcuts?: { all?: string; invert?: string };
  theme?: Partial<Theme<CheckboxTheme>>;
};

function isSelectable<V>(item: NormalizedChoice<V> | Separator): item is NormalizedChoice<V> {
  return !Separator.isSeparator(item) && !item.disabled;
}

function isChecked<V>(item: NormalizedChoice<V> | Separator): item is NormalizedChoice<V> {
  return isSelectable(item) && item.checked;
}

function toggle<V>(item: NormalizedChoice<V> | Separator): NormalizedChoice<V> | Separator {
  return isSelectable(item) ? { ...item, checked: !item.checked } : item;
}

function check<V>(checked: boolean) {
  return function (item: NormalizedChoice<V> | Separator): NormalizedChoice<V> | Separator {
    return isSelectable(item) ? { ...item, checked } : item;
  };
}

function normalizeChoices<V>(
  choices: ReadonlyArray<Choice<V> | Separator>,
): (NormalizedChoice<V> | Separator)[] {
  return choices.map((choice) => {
    if (Separator.isSeparator(choice)) return choice;
    if (typeof choice === "string") {
      return {
        value: choice as V,
        name: choice as string,
        short: choice as string,
        checkedName: choice as string,
        disabled: false,
        checked: false,
      };
    }
    const name = choice.name ?? String(choice.value);
    const normalizedChoice: NormalizedChoice<V> = {
      value: choice.value,
      name,
      short: choice.short ?? name,
      checkedName: choice.checkedName ?? name,
      disabled: choice.disabled ?? false,
      checked: choice.checked ?? false,
    };
    if (choice.description) {
      normalizedChoice.description = choice.description;
    }
    return normalizedChoice;
  });
}

export default createPrompt(
  <Value,>(config: Config<Value>, done: (value: Value[]) => void) => {
    const {
      instructions,
      pageSize = 7,
      loop = true,
      required,
      validate = () => true,
    } = config;
    const shortcuts = { all: "a", invert: "i", ...config.shortcuts };
    const theme = makeTheme<CheckboxTheme>(checkboxTheme, config.theme);
    const { keybindings } = theme;
    const [status, setStatus] = useState<Status>("idle");
    const prefix = usePrefix({ status, theme });
    const [items, setItems] = useState(normalizeChoices(config.choices));
    const bounds = useMemo(() => {
      const first = items.findIndex(isSelectable);
      let last = -1;
      for (let i = items.length - 1; i >= 0; i--) {
        if (isSelectable(items[i]!)) { last = i; break; }
      }
      if (first === -1) {
        throw new ValidationError(
          "[checkbox prompt] No selectable choices. All choices are disabled.",
        );
      }
      return { first, last };
    }, [items]);
    const [active, setActive] = useState(bounds.first);
    const [errorMsg, setError] = useState<string | undefined>();
    const [gooseFrame, setGooseFrame] = useState(0);

    useKeypress(async (key) => {
      if (isEnterKey(key)) {
        const selection = items.filter(isChecked);
        const isValid = await validate([...selection] as NormalizedChoice<Value>[]);
        if (required && !items.some(isChecked)) {
          setError("At least one choice must be selected");
        } else if (isValid === true) {
          setStatus("done");
          done(
            (selection as NormalizedChoice<Value>[]).map((choice) => choice.value),
          );
        } else {
          setError((isValid as string) || "You must select a valid value");
        }
      } else if (isUpKey(key, keybindings) || isDownKey(key, keybindings)) {
        if (
          loop ||
          (isUpKey(key, keybindings) && active !== bounds.first) ||
          (isDownKey(key, keybindings) && active !== bounds.last)
        ) {
          const offset = isUpKey(key, keybindings) ? -1 : 1;
          let next = active;
          do {
            next = (next + offset + items.length) % items.length;
          } while (!isSelectable(items[next]!));
          setActive(next);
        }
        setGooseFrame((gooseFrame + 1) % GOOSE_FRAMES.length);
      } else if (isSpaceKey(key)) {
        setError(undefined);
        setItems(
          items.map((choice, i) => (i === active ? toggle(choice) : choice)),
        );
        setGooseFrame((gooseFrame + 1) % GOOSE_FRAMES.length);
      } else if (key.name === shortcuts.all) {
        const selectAll = items.some(
          (choice) => isSelectable(choice) && !choice.checked,
        );
        setItems(items.map(check(selectAll)));
        setGooseFrame((gooseFrame + 1) % GOOSE_FRAMES.length);
      } else if (key.name === shortcuts.invert) {
        setItems(items.map(toggle));
        setGooseFrame((gooseFrame + 1) % GOOSE_FRAMES.length);
      } else if (isNumberKey(key)) {
        const selectedIndex = Number(key.name) - 1;
        let selectableIndex = -1;
        const position = items.findIndex((item) => {
          if (Separator.isSeparator(item)) return false;
          selectableIndex++;
          return selectableIndex === selectedIndex;
        });
        const selectedItem = items[position];
        if (selectedItem && isSelectable(selectedItem)) {
          setActive(position);
          setItems(
            items.map((choice, i) =>
              i === position ? toggle(choice) : choice,
            ),
          );
        }
        setGooseFrame((gooseFrame + 1) % GOOSE_FRAMES.length);
      }
    });

    const message = theme.style.message(config.message, status);
    let description: string | undefined;
    const page = usePagination({
      items,
      active,
      renderItem({
        item,
        isActive,
      }: {
        item: NormalizedChoice<Value> | Separator;
        index: number;
        isActive: boolean;
      }) {
        if (Separator.isSeparator(item)) {
          return ` ${item.separator}`;
        }
        if (item.disabled) {
          const disabledLabel =
            typeof item.disabled === "string" ? item.disabled : "(disabled)";
          return theme.style.disabledChoice(`${item.name} ${disabledLabel}`);
        }
        if (isActive) {
          description = item.description;
        }
        const checkbox = item.checked
          ? theme.icon.checked
          : theme.icon.unchecked;
        const name = item.checked ? item.checkedName : item.name;
        const color = isActive ? theme.style.highlight : (x: string) => x;
        const cursor = isActive ? theme.icon.cursor : " ";
        return color(`${cursor}${checkbox} ${name}`);
      },
      pageSize,
      loop,
    });

    if (status === "done") {
      const selection = items.filter(isChecked) as NormalizedChoice<Value>[];
      const answer = theme.style.answer(
        theme.style.renderSelectedChoices(selection, items),
      );
      return [prefix, message, answer].filter(Boolean).join(" ");
    }

    let helpLine: string | undefined;
    if (theme.helpMode !== "never" && instructions !== false) {
      if (typeof instructions === "string") {
        helpLine = instructions;
      } else {
        const keys: [string, string][] = [
          ["↑↓", "navigate"],
          ["space", "select"],
        ];
        if (shortcuts.all) keys.push([shortcuts.all, "all"]);
        if (shortcuts.invert) keys.push([shortcuts.invert, "invert"]);
        keys.push(["⏎", "submit"]);
        helpLine = theme.style.keysHelpTip(keys);
      }
    }

    const lines = [
      [prefix, message].filter(Boolean).join(" "),
      page,
      " ",
      description ? theme.style.description(description) : "",
      errorMsg ? theme.style.error(errorMsg) : "",
      helpLine,
    ]
      .filter(Boolean)
      .join("\n")
      .trimEnd();

    return `${renderWithGoose(lines, gooseFrame)}${cursorHide}`;
  },
);

export { Separator } from "@inquirer/core";
