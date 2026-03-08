"use client";

import { useState } from "react";
import { pinyin } from "pinyin-pro";

export default function Home() {
  const [input, setInput] = useState("");
  const [toneType, setToneType] = useState<"symbol" | "num" | "none">("symbol");

  const result = input
    ? pinyin(input, { toneType, separator: " " })
    : "";

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Pinyinny</h1>
      <p style={styles.subtitle}>Convert Chinese characters to pinyin</p>

      <textarea
        style={styles.textarea}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type or paste Chinese text here…"
        rows={4}
      />

      <div style={styles.options}>
        {(["symbol", "num", "none"] as const).map((t) => (
          <label key={t} style={styles.label}>
            <input
              type="radio"
              name="toneType"
              value={t}
              checked={toneType === t}
              onChange={() => setToneType(t)}
            />
            {t === "symbol" ? "Tone marks (nǐ)" : t === "num" ? "Numbers (ni3)" : "No tones (ni)"}
          </label>
        ))}
      </div>

      {result && (
        <div style={styles.result}>
          <p style={styles.resultText}>{result}</p>
        </div>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
    fontFamily: "system-ui, sans-serif",
    background: "#f9fafb",
  },
  title: {
    fontSize: "2.5rem",
    fontWeight: 800,
    margin: 0,
    color: "#111827",
  },
  subtitle: {
    color: "#6b7280",
    marginTop: "0.5rem",
    marginBottom: "2rem",
  },
  textarea: {
    width: "100%",
    maxWidth: "600px",
    padding: "1rem",
    fontSize: "1.25rem",
    borderRadius: "0.5rem",
    border: "1px solid #d1d5db",
    resize: "vertical",
    outline: "none",
  },
  options: {
    display: "flex",
    gap: "1.5rem",
    marginTop: "1rem",
  },
  label: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    cursor: "pointer",
    color: "#374151",
  },
  result: {
    marginTop: "2rem",
    padding: "1rem 1.5rem",
    background: "#fff",
    borderRadius: "0.5rem",
    border: "1px solid #e5e7eb",
    maxWidth: "600px",
    width: "100%",
    wordBreak: "break-all",
  },
  resultText: {
    fontSize: "1.25rem",
    color: "#1d4ed8",
    margin: 0,
    lineHeight: 1.8,
  },
};
