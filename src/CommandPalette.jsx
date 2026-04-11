import { useEffect, useRef, useState, useMemo } from "react";

const COMMANDS = [
  { cmd: "add", alias: ["a", "new"], args: "<hanzi>", desc: "添加词卡到当前类别" },
  { cmd: "study", alias: ["s"], args: "[category]", desc: "开始学习某一组" },
  { cmd: "search", alias: ["find", "f"], args: "<keyword>", desc: "搜索词卡" },
  { cmd: "shuffle", alias: [], args: "", desc: "切换随机顺序" },
  { cmd: "wrong", alias: ["w"], args: "", desc: "切换只学不会" },
  { cmd: "export", alias: ["backup"], args: "", desc: "下载备份" },
  { cmd: "stats", alias: ["info"], args: "", desc: "查看统计" },
  { cmd: "go", alias: ["tab"], args: "<study|cards|more>", desc: "切换标签页" },
  { cmd: "cat", alias: ["category"], args: "", desc: "列出所有类别" },
  { cmd: "clear", alias: [], args: "", desc: "清除进度" },
  { cmd: "help", alias: ["?", "h"], args: "", desc: "显示帮助" },
];

function resolveCommand(input) {
  const lower = input.toLowerCase();
  for (const c of COMMANDS) {
    if (c.cmd === lower || c.alias.includes(lower)) return c.cmd;
  }
  return null;
}

function CommandPalette({ open, onClose, actions }) {
  const inputRef = useRef(null);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const outputEndRef = useRef(null);

  useEffect(() => {
    if (open) {
      setInput("");
      setOutput([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q || q.startsWith("/")) {
      const prefix = q.replace(/^\//, "");
      return COMMANDS.filter((c) => !prefix || c.cmd.startsWith(prefix) || c.alias.some((a) => a.startsWith(prefix)));
    }
    return [];
  }, [input]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions.length]);

  function pushOutput(type, text) {
    setOutput((prev) => [...prev, { type, text, id: Date.now() + Math.random() }]);
  }

  function execute(raw) {
    const trimmed = raw.trim().replace(/^\//, "");
    if (!trimmed) return;

    const [first, ...rest] = trimmed.split(/\s+/);
    const arg = rest.join(" ").trim();
    const cmd = resolveCommand(first);

    pushOutput("input", `/ ${trimmed}`);

    if (!cmd) {
      // Treat as quick-add if it contains Chinese characters
      if (/[\u4e00-\u9fff]/.test(trimmed)) {
        const result = actions.quickAdd(trimmed);
        pushOutput("ok", result);
      } else {
        pushOutput("error", `未知命令: ${first}。输入 /help 查看帮助。`);
      }
      return;
    }

    switch (cmd) {
      case "help": {
        const lines = COMMANDS.map((c) => `/${c.cmd} ${c.args}  — ${c.desc}`);
        pushOutput("info", "可用命令:\n" + lines.join("\n") + "\n\n提示: 直接输入汉字可快速添加词卡\n快捷键: ⌘K 或 / 打开");
        break;
      }
      case "add": {
        if (!arg) { pushOutput("error", "请输入要添加的汉字。例: /add 法律"); break; }
        const result = actions.quickAdd(arg);
        pushOutput("ok", result);
        break;
      }
      case "study": {
        const result = actions.startStudy(arg || null);
        pushOutput("ok", result);
        if (!arg) onClose();
        break;
      }
      case "search": {
        if (!arg) { pushOutput("error", "请输入搜索关键词。"); break; }
        const results = actions.search(arg);
        if (results.length === 0) {
          pushOutput("info", `没有找到: "${arg}"`);
        } else {
          const lines = results.slice(0, 15).map((c) => `  ${c.hanzi}  ${c.pinyin}  [${c.set}]`);
          pushOutput("info", `找到 ${results.length} 张:\n${lines.join("\n")}${results.length > 15 ? `\n  ...还有 ${results.length - 15} 张` : ""}`);
        }
        break;
      }
      case "shuffle": {
        const result = actions.toggleShuffle();
        pushOutput("ok", result);
        break;
      }
      case "wrong": {
        const result = actions.toggleOnlyWrong();
        pushOutput("ok", result);
        break;
      }
      case "export": {
        actions.exportBackup();
        pushOutput("ok", "已下载备份文件。");
        break;
      }
      case "stats": {
        const stats = actions.getStats();
        pushOutput("info", stats);
        break;
      }
      case "go": {
        const tabMap = { study: "study", cards: "cards", more: "more", "学习": "study", "词卡": "cards", "更多": "more" };
        const target = tabMap[arg.toLowerCase()];
        if (!target) { pushOutput("error", "可选: study, cards, more"); break; }
        actions.goToTab(target);
        pushOutput("ok", `已切换到 ${target}`);
        onClose();
        break;
      }
      case "cat": {
        const cats = actions.getCategories();
        pushOutput("info", `类别 (${cats.length}):\n${cats.map((c) => `  ${c.name}  ${c.count}张${c.wrongCount > 0 ? ` (不会${c.wrongCount})` : ""}`).join("\n")}`);
        break;
      }
      case "clear": {
        actions.clearProgress();
        pushOutput("ok", "已清除所有进度。");
        break;
      }
      default:
        pushOutput("error", `命令 "${cmd}" 暂未实现。`);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "Enter") {
      if (suggestions.length > 0 && !input.includes(" ") && input.replace(/^\//, "").trim() !== suggestions[selectedIndex]?.cmd) {
        setInput("/" + suggestions[selectedIndex].cmd + " ");
        return;
      }
      execute(input);
      setInput("");
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
    if (e.key === "Tab" && suggestions.length > 0) {
      e.preventDefault();
      setInput("/" + suggestions[selectedIndex].cmd + " ");
    }
  }

  if (!open) return null;

  return (
    <div className="cli-backdrop" onClick={onClose}>
      <div className="cli-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cli-header">
          <span className="cli-prompt">$</span>
          <input
            ref={inputRef}
            className="cli-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入命令或汉字... (Tab 补全, /help 帮助)"
            spellCheck={false}
            autoComplete="off"
          />
          <button className="cli-close" type="button" onClick={onClose}>
            <kbd>esc</kbd>
          </button>
        </div>

        {suggestions.length > 0 && !output.length && (
          <div className="cli-suggestions">
            {suggestions.map((s, i) => (
              <button
                key={s.cmd}
                className={`cli-suggestion ${i === selectedIndex ? "active" : ""}`}
                type="button"
                onClick={() => { setInput("/" + s.cmd + " "); inputRef.current?.focus(); }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="cli-cmd">/{s.cmd}</span>
                {s.args && <span className="cli-args">{s.args}</span>}
                <span className="cli-desc">{s.desc}</span>
              </button>
            ))}
          </div>
        )}

        {output.length > 0 && (
          <div className="cli-output">
            {output.map((entry) => (
              <div key={entry.id} className={`cli-line cli-${entry.type}`}>
                <pre>{entry.text}</pre>
              </div>
            ))}
            <div ref={outputEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}

export default CommandPalette;
