import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CATEGORIES, starterCards, starterCategories } from "./data/starterCards";
import { generatePinyin } from "./lib/pinyin";
import CommandPalette from "./CommandPalette";
import DrawingCanvas from "./DrawingCanvas";

const LEGACY_CATEGORY_NAMES = {
  手写订正: "订正",
};

const STORAGE_KEYS = {
  cards: "拼音卡.cards.v2",
  categories: "拼音卡.categories.v1",
  progress: "拼音卡.progress.v2",
  wrongBook: "拼音卡.wrong-book.v2",
  studyOptions: "拼音卡.study-options.v1",
  lastStudiedCategory: "拼音卡.last-studied-category.v1",
};

const STORAGE_KEY_FALLBACKS = {
  "拼音卡.cards.v2": ["pinyinka.cards.v2", "pinyinny.cards.v2"],
  "拼音卡.categories.v1": ["pinyinka.categories.v1", "pinyinny.categories.v1"],
  "拼音卡.progress.v2": ["pinyinka.progress.v2", "pinyinny.progress.v2"],
  "拼音卡.wrong-book.v2": ["pinyinka.wrong-book.v2", "pinyinny.wrong-book.v2"],
  "拼音卡.study-options.v1": ["pinyinka.study-options.v1", "pinyinny.study-options.v1"],
  "拼音卡.last-studied-category.v1": [
    "pinyinka.last-studied-category.v1",
    "pinyinny.last-studied-category.v1",
  ],
};

const ALL_CATEGORY = "__all__";

const BLANK_STUDY_OPTIONS = {
  shuffle: false,
  onlyWrong: false,
  handwriting: true,
};

const BLANK_ADD_FORM = {
  category: "",
  hanzi: "",
  pinyin: "",
};

const BLANK_IMPORT_FORM = {
  category: "",
  text: "",
};

const BLANK_CATEGORY_FORM = {
  value: "",
};

const BLANK_EDIT_DRAFT = {
  set: "",
  pinyin: "",
  hanzi: "",
};

// ── Storage helpers ──

function readStorage(key, fallback) {
  try {
    const keys = [key, ...(STORAGE_KEY_FALLBACKS[key] ?? [])];
    for (const storageKey of keys) {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

// ── One-time migration: merge new starter cards ──

const MIGRATION_KEY = "拼音卡.starter-migration.v2";

function mergeStarterCards(existingCards, existingCategories) {
  const migrated = window.localStorage.getItem(MIGRATION_KEY);
  if (migrated === String(starterCards.length)) return { cards: existingCards, categories: existingCategories };

  const existingHanzi = new Set(existingCards.map((c) => c.hanzi));
  const newCards = starterCards.filter((c) => !existingHanzi.has(c.hanzi));
  const mergedCards = [...existingCards, ...newCards];
  const newCats = starterCategories.filter((c) => !existingCategories.includes(c));
  const mergedCategories = [...existingCategories, ...newCats];

  window.localStorage.setItem(MIGRATION_KEY, String(starterCards.length));
  return { cards: mergedCards, categories: mergedCategories };
}

// ── Pure helpers ──

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function shuffleArray(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function orderIds(ids, shouldShuffle, orderLookup) {
  const next = [...ids];
  if (shouldShuffle) return shuffleArray(next);
  return next.sort(
    (a, b) => (orderLookup[a] ?? Number.MAX_SAFE_INTEGER) - (orderLookup[b] ?? Number.MAX_SAFE_INTEGER),
  );
}

function reorderCurrentIds(ids, index, shouldShuffle, orderLookup) {
  const safeIndex = Math.min(Math.max(0, Number(index) || 0), ids.length);
  const answered = ids.slice(0, safeIndex);
  if (safeIndex >= ids.length) return answered;
  const current = ids[safeIndex];
  const queued = orderIds(ids.slice(safeIndex + 1), shouldShuffle, orderLookup);
  return [...answered, current, ...queued];
}

function reorderProgressItem(progress, shouldShuffle, orderLookup) {
  return {
    ...progress,
    shuffle: shouldShuffle,
    currentIds: reorderCurrentIds(progress.currentIds ?? [], progress.index ?? 0, shouldShuffle, orderLookup),
    wrongIdsNextRound: orderIds(progress.wrongIdsNextRound ?? [], shouldShuffle, orderLookup),
  };
}

function normalizeCategoryName(value) {
  const name = String(value ?? "").trim();
  return LEGACY_CATEGORY_NAMES[name] ?? name;
}

function uniqueCategories(values) {
  return Array.from(new Set(values.map((v) => normalizeCategoryName(v)).filter(Boolean)));
}

function sanitizeCategories(categories, cards) {
  return uniqueCategories([...(categories ?? []), ...cards.map((c) => c.set)]);
}

function sanitizeWrongBook(wrongBook, cards, categories) {
  const cardIds = new Set(cards.map((c) => c.id));
  return Object.fromEntries(
    categories.map((cat) => [cat, uniqueCategories(wrongBook?.[cat] ?? []).filter((id) => cardIds.has(id))]),
  );
}

function sanitizeStudyOptions(options) {
  return { shuffle: Boolean(options?.shuffle), onlyWrong: Boolean(options?.onlyWrong), handwriting: options?.handwriting !== false };
}

function sanitizeCards(cards) {
  return (cards ?? []).map((card, i) => ({
    id: card.id || `starter-${i + 1}`,
    set: normalizeCategoryName(card.set ?? DEFAULT_CATEGORIES[0]) || DEFAULT_CATEGORIES[0],
    pinyin: String(card.pinyin ?? "").trim(),
    hanzi: String(card.hanzi ?? "").trim(),
  }));
}

function sanitizeProgressItem(progress, cards, categories) {
  if (!progress?.category) return null;
  const category = progress.category === ALL_CATEGORY ? ALL_CATEGORY : normalizeCategoryName(progress.category);
  if (category !== ALL_CATEGORY && !categories.includes(category)) return null;

  const cardIds = new Set(cards.map((c) => c.id));
  const currentIds = (progress.currentIds ?? []).filter((id) => cardIds.has(id));
  const wrongIdsNextRound = (progress.wrongIdsNextRound ?? []).filter((id) => cardIds.has(id));
  const history = Array.isArray(progress.history)
    ? progress.history
        .filter((e) => cardIds.has(e.cardId))
        .map((e) => ({ cardId: e.cardId, knew: Boolean(e.knew), prevWasWrong: Boolean(e.prevWasWrong) }))
    : [];

  if (currentIds.length === 0 && wrongIdsNextRound.length === 0) return null;

  return {
    category,
    round: Math.max(1, Number(progress.round) || 1),
    currentIds,
    wrongIdsNextRound,
    index: Math.min(Math.max(0, Number(progress.index) || 0), currentIds.length),
    revealed: Boolean(progress.revealed),
    shuffle: Boolean(progress.shuffle),
    onlyWrong: Boolean(progress.onlyWrong),
    history: history.slice(0, currentIds.length),
  };
}

function sanitizeProgressMap(progressMap, cards, categories) {
  if (!progressMap || typeof progressMap !== "object" || Array.isArray(progressMap)) {
    const single = sanitizeProgressItem(progressMap, cards, categories);
    return single ? { [single.category]: single } : {};
  }
  return Object.fromEntries(
    Object.entries(progressMap)
      .map(([cat, val]) => {
        const key = cat === ALL_CATEGORY ? ALL_CATEGORY : normalizeCategoryName(cat);
        return [key, sanitizeProgressItem({ ...val, category: key }, cards, categories)];
      })
      .filter(([, val]) => Boolean(val)),
  );
}

function exportBackup(cards, categories, wrongBook, progressMap, studyOptions) {
  return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), cards, categories, wrongBook, progress: progressMap, studyOptions }, null, 2);
}

function normalizeImportedCards(cards, fallbackCategory) {
  return cards
    .map((card) => {
      const hanzi = String(card.hanzi ?? "").trim();
      const pinyin = String(card.pinyin ?? "").trim() || generatePinyin(hanzi);
      return { id: card.id || makeId(), set: normalizeCategoryName(card.set ?? fallbackCategory) || fallbackCategory, pinyin, hanzi };
    })
    .filter((c) => c.hanzi);
}

function getCategoryChoice(selected, newValue) {
  if (selected === "__new__") return String(newValue ?? "").trim();
  return String(selected ?? "").trim();
}

function buildImportPreview(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((hanzi) => ({ hanzi, pinyin: generatePinyin(hanzi) }));
}

function removeLastOccurrence(items, value) {
  const next = [...items];
  const idx = next.lastIndexOf(value);
  if (idx >= 0) next.splice(idx, 1);
  return next;
}

// ── App ──

function App() {
  const merged = mergeStarterCards(sanitizeCards(readStorage(STORAGE_KEYS.cards, starterCards)), sanitizeCategories(readStorage(STORAGE_KEYS.categories, starterCategories), readStorage(STORAGE_KEYS.cards, starterCards)));
  const initialCards = merged.cards;
  const initialCategories = sanitizeCategories(merged.categories, initialCards);
  const initialWrongBook = sanitizeWrongBook(readStorage(STORAGE_KEYS.wrongBook, {}), initialCards, initialCategories);
  const initialProgressMap = sanitizeProgressMap(readStorage(STORAGE_KEYS.progress, null), initialCards, initialCategories);
  const initialStudyOptions = sanitizeStudyOptions(readStorage(STORAGE_KEYS.studyOptions, BLANK_STUDY_OPTIONS));
  const initialLastStudied = normalizeCategoryName(readStorage(STORAGE_KEYS.lastStudiedCategory, null));

  const [tab, setTab] = useState("study");
  const [cards, setCards] = useState(initialCards);
  const [categories, setCategories] = useState(initialCategories);
  const [wrongBook, setWrongBook] = useState(initialWrongBook);
  const [progressMap, setProgressMap] = useState(initialProgressMap);
  const [studyCategory, setStudyCategory] = useState(Object.keys(initialProgressMap)[0] ?? null);
  const [studyOptions, setStudyOptions] = useState(initialStudyOptions);
  const [lastStudiedCategory, setLastStudiedCategory] = useState(initialLastStudied);
  const [studyMessage, setStudyMessage] = useState("");
  const [isStudying, setIsStudying] = useState(false);

  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("全部");
  const [addForm, setAddForm] = useState(() => ({ ...BLANK_ADD_FORM, category: initialCategories[0] ?? DEFAULT_CATEGORIES[0] }));
  const [importForm, setImportForm] = useState(() => ({ ...BLANK_IMPORT_FORM, category: initialCategories[0] ?? DEFAULT_CATEGORIES[0] }));
  const [newCategoryForm, setNewCategoryForm] = useState(BLANK_CATEGORY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editingDraft, setEditingDraft] = useState(BLANK_EDIT_DRAFT);
  const [exportText, setExportText] = useState("");
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [selectedCardIds, setSelectedCardIds] = useState(() => new Set());
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [manageMessage, setManageMessage] = useState("");
  const [cliOpen, setCliOpen] = useState(false);

  // ── Persist ──

  useEffect(() => { writeStorage(STORAGE_KEYS.cards, cards); }, [cards]);
  useEffect(() => { writeStorage(STORAGE_KEYS.categories, categories); }, [categories]);
  useEffect(() => { writeStorage(STORAGE_KEYS.wrongBook, wrongBook); }, [wrongBook]);
  useEffect(() => { writeStorage(STORAGE_KEYS.studyOptions, studyOptions); }, [studyOptions]);

  useEffect(() => {
    if (!lastStudiedCategory) { window.localStorage.removeItem(STORAGE_KEYS.lastStudiedCategory); return; }
    writeStorage(STORAGE_KEYS.lastStudiedCategory, lastStudiedCategory);
  }, [lastStudiedCategory]);

  useEffect(() => {
    if (Object.keys(progressMap).length > 0) { writeStorage(STORAGE_KEYS.progress, progressMap); return; }
    window.localStorage.removeItem(STORAGE_KEYS.progress);
  }, [progressMap]);

  // ── Sync derived state ──

  useEffect(() => {
    const nextCategories = sanitizeCategories(categories, cards);
    if (JSON.stringify(nextCategories) !== JSON.stringify(categories)) { setCategories(nextCategories); return; }
    const nextWrongBook = sanitizeWrongBook(wrongBook, cards, nextCategories);
    if (JSON.stringify(nextWrongBook) !== JSON.stringify(wrongBook)) { setWrongBook(nextWrongBook); return; }
    const nextProgressMap = sanitizeProgressMap(progressMap, cards, nextCategories);
    if (JSON.stringify(nextProgressMap) !== JSON.stringify(progressMap)) setProgressMap(nextProgressMap);
    if (lastStudiedCategory && !nextCategories.includes(lastStudiedCategory)) setLastStudiedCategory(null);
  }, [cards, categories, lastStudiedCategory, progressMap, wrongBook]);

  useEffect(() => {
    if (!categories.includes(addForm.category)) setAddForm((c) => ({ ...c, category: categories[0] ?? DEFAULT_CATEGORIES[0] }));
    if (!categories.includes(importForm.category)) setImportForm((c) => ({ ...c, category: categories[0] ?? DEFAULT_CATEGORIES[0] }));
  }, [categories, addForm.category, importForm.category]);

  // ── Memos ──

  const cardsById = useMemo(() => Object.fromEntries(cards.map((c) => [c.id, c])), [cards]);
  const cardOrderLookup = useMemo(() => Object.fromEntries(cards.map((c, i) => [c.id, i])), [cards]);

  const setSummaries = useMemo(
    () => categories.map((cat) => ({
      category: cat,
      count: cards.filter((c) => c.set === cat).length,
      wrongCount: (wrongBook[cat] ?? []).length,
      progress: progressMap[cat] ?? null,
    })),
    [cards, categories, wrongBook, progressMap],
  );

  const allSummary = useMemo(() => {
    const allWrongIds = new Set(Object.values(wrongBook).flat());
    return {
      category: ALL_CATEGORY,
      count: cards.length,
      wrongCount: allWrongIds.size,
      progress: progressMap[ALL_CATEGORY] ?? null,
    };
  }, [cards, wrongBook, progressMap]);

  const progress = studyCategory ? progressMap[studyCategory] ?? null : null;
  const currentCard = progress ? cardsById[progress.currentIds[progress.index]] : null;
  const roundDone = Boolean(progress) && progress.index >= progress.currentIds.length && progress.wrongIdsNextRound.length > 0;

  const filteredCards = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return cards
      .filter((c) => filterCategory === "全部" || c.set === filterCategory)
      .filter((c) => !keyword || [c.set, c.hanzi, c.pinyin].join(" ").toLowerCase().includes(keyword));
  }, [cards, filterCategory, search]);

  const importPreview = useMemo(() => buildImportPreview(importForm.text), [importForm.text]);
  const addPreviewPinyin = useMemo(
    () => addForm.hanzi.split("\n").map((l) => (l.trim() ? generatePinyin(l.trim()) : "")).join("\n"),
    [addForm.hanzi],
  );

  // ── Navigation ──

  function exitStudy() {
    setIsStudying(false);
    setStudyMessage("");
    setStudyCategory(null);
  }

  // ── Category helpers ──

  function ensureCategoryExists(name) {
    const next = normalizeCategoryName(name);
    if (!next) return null;
    if (!categories.includes(next)) setCategories([...categories, next]);
    return next;
  }

  // ── Study logic ──

  function buildStudyProgress(category, options) {
    let selected;
    if (category === ALL_CATEGORY) {
      selected = [...cards];
    } else {
      selected = cards.filter((c) => c.set === category);
    }

    if (options.onlyWrong) {
      if (category === ALL_CATEGORY) {
        const allWrongIds = new Set(Object.values(wrongBook).flat());
        selected = selected.filter((c) => allWrongIds.has(c.id));
      } else {
        const wrongIds = new Set(wrongBook[category] ?? []);
        selected = selected.filter((c) => wrongIds.has(c.id));
      }
    }

    if (options.shuffle) selected = shuffleArray(selected);

    return {
      category, round: 1, currentIds: selected.map((c) => c.id),
      wrongIdsNextRound: [], index: 0, revealed: false,
      shuffle: options.shuffle, onlyWrong: options.onlyWrong, history: [],
    };
  }

  function startStudy(category) {
    const next = buildStudyProgress(category, studyOptions);
    setStudyMessage("");
    setStudyCategory(category);
    if (category !== ALL_CATEGORY) setLastStudiedCategory(category);
    setProgressMap((cur) => next.currentIds.length > 0 ? { ...cur, [category]: next } : cur);
    setIsStudying(true);

    if (next.currentIds.length === 0) {
      if (studyOptions.onlyWrong) {
        setStudyMessage("这一组现在没有不会的词。");
        setStudyCategory(null);
      } else {
        setStudyMessage("无词卡");
        setStudyCategory(null);
        setIsStudying(false);
        setTab("cards");
        setFilterCategory(category === ALL_CATEGORY ? "全部" : category);
      }
    }
  }

  function continueStudy(category) {
    setStudyMessage("");
    setStudyCategory(category);
    if (category !== ALL_CATEGORY) setLastStudiedCategory(category);
    setIsStudying(true);
  }

  function restartStudyProgress(category) {
    if (!category) return;
    const existing = progressMap[category];
    if (!existing) return;
    const next = buildStudyProgress(category, { shuffle: existing.shuffle, onlyWrong: existing.onlyWrong });
    setProgressMap((cur) => ({ ...cur, [category]: next }));
    setStudyMessage("");
  }

  function toggleStudyOption(key) {
    setStudyOptions((cur) => {
      const nextVal = !cur[key];
      if (key === "shuffle") {
        setProgressMap((pm) =>
          Object.fromEntries(Object.entries(pm).map(([cat, item]) => [cat, reorderProgressItem(item, nextVal, cardOrderLookup)])),
        );
      }
      return { ...cur, [key]: nextVal };
    });
  }

  function revealCard() {
    if (!progress || !currentCard) return;
    setProgressMap({ ...progressMap, [progress.category]: { ...progress, revealed: !progress.revealed } });
  }

  function markCard(knew) {
    if (!progress || !currentCard) return;

    const cat = currentCard.set;
    const nextWrongSet = new Set(wrongBook[cat] ?? []);
    const prevWasWrong = nextWrongSet.has(currentCard.id);
    if (knew) nextWrongSet.delete(currentCard.id);
    else nextWrongSet.add(currentCard.id);
    setWrongBook({ ...wrongBook, [cat]: [...nextWrongSet] });

    const nextWrongIds = knew ? progress.wrongIdsNextRound : [...progress.wrongIdsNextRound, currentCard.id];
    const nextIndex = progress.index + 1;
    const finished = nextIndex >= progress.currentIds.length;

    if (finished && nextWrongIds.length === 0) {
      const next = { ...progressMap };
      delete next[progress.category];
      setProgressMap(next);
      setStudyCategory(null);
      setStudyMessage(`完成，第 ${progress.round} 轮全部答对。`);
      return;
    }

    setProgressMap({
      ...progressMap,
      [progress.category]: {
        ...progress, wrongIdsNextRound: nextWrongIds, index: nextIndex, revealed: false,
        history: [...(progress.history ?? []), { cardId: currentCard.id, knew, prevWasWrong }],
      },
    });
  }

  function continueNextRound() {
    if (!progress || progress.wrongIdsNextRound.length === 0) return;
    const nextIds = progress.shuffle ? shuffleArray(progress.wrongIdsNextRound) : [...progress.wrongIdsNextRound];
    setProgressMap({
      ...progressMap,
      [progress.category]: { ...progress, round: progress.round + 1, currentIds: nextIds, wrongIdsNextRound: [], index: 0, revealed: false, history: [] },
    });
  }

  function restartRound() {
    if (!progress) return;
    const nextWrongBook = { ...wrongBook };
    for (const entry of [...(progress.history ?? [])].reverse()) {
      const card = cardsById[entry.cardId];
      const cat = card?.set ?? progress.category;
      if (cat === ALL_CATEGORY) continue;
      const catWrong = new Set(nextWrongBook[cat] ?? []);
      if (entry.prevWasWrong) catWrong.add(entry.cardId);
      else catWrong.delete(entry.cardId);
      nextWrongBook[cat] = [...catWrong];
    }
    setWrongBook(nextWrongBook);
    const nextIds = progress.shuffle ? shuffleArray(progress.currentIds) : [...progress.currentIds];
    setProgressMap({ ...progressMap, [progress.category]: { ...progress, currentIds: nextIds, wrongIdsNextRound: [], index: 0, revealed: false, history: [] } });
    setStudyMessage("");
  }

  function goToPreviousCard() {
    if (!progress || !(progress.history?.length > 0)) return;
    const lastEntry = progress.history[progress.history.length - 1];
    const card = cardsById[lastEntry.cardId];
    const cat = card?.set ?? progress.category;

    if (cat !== ALL_CATEGORY) {
      const restored = new Set(wrongBook[cat] ?? []);
      if (lastEntry.prevWasWrong) restored.add(lastEntry.cardId);
      else restored.delete(lastEntry.cardId);
      setWrongBook({ ...wrongBook, [cat]: [...restored] });
    }

    setProgressMap({
      ...progressMap,
      [progress.category]: {
        ...progress, index: Math.max(progress.index - 1, 0), revealed: false,
        wrongIdsNextRound: lastEntry.knew ? progress.wrongIdsNextRound : removeLastOccurrence(progress.wrongIdsNextRound, lastEntry.cardId),
        history: progress.history.slice(0, -1),
      },
    });
  }

  // ── Card CRUD ──

  function submitAddCard(event) {
    event.preventDefault();
    const category = getCategoryChoice(addForm.category, newCategoryForm.value);
    if (!category) { setManageMessage("请选择类别或添加类别。"); return; }
    const hanziLines = addForm.hanzi.split("\n").map((l) => l.trim()).filter(Boolean);
    if (hanziLines.length === 0) { setManageMessage("请输入汉字。"); return; }
    const pinyinLines = (addForm.pinyin || addPreviewPinyin).split("\n").map((l) => l.trim());
    ensureCategoryExists(category);
    const newCards = hanziLines.map((hanzi, i) => ({ id: makeId(), set: category, hanzi, pinyin: pinyinLines[i] || generatePinyin(hanzi) }));
    setCards([...newCards, ...cards]);
    setAddForm({ ...BLANK_ADD_FORM, category });
    setNewCategoryForm(BLANK_CATEGORY_FORM);
    setManageMessage(`已添加 ${newCards.length} 张词卡。`);
  }

  function startEditing(card) {
    setEditingId(card.id);
    setEditingDraft({ set: card.set, pinyin: card.pinyin, hanzi: card.hanzi });
  }

  function saveEdit() {
    if (!editingId || !editingDraft.hanzi.trim()) return;
    const prev = cards.find((c) => c.id === editingId);
    if (!prev) return;
    const nextCat = ensureCategoryExists(editingDraft.set) ?? prev.set;
    const nextCards = cards.map((c) =>
      c.id === editingId ? { ...c, set: nextCat, hanzi: editingDraft.hanzi.trim(), pinyin: editingDraft.pinyin.trim() || generatePinyin(editingDraft.hanzi) } : c,
    );
    setCards(nextCards);
    if (prev.set !== nextCat) {
      const wb = { ...wrongBook };
      const wasWrong = (wb[prev.set] ?? []).includes(editingId);
      wb[prev.set] = (wb[prev.set] ?? []).filter((id) => id !== editingId);
      if (wasWrong) wb[nextCat] = [...(wb[nextCat] ?? []), editingId];
      setWrongBook(sanitizeWrongBook(wb, nextCards, sanitizeCategories(categories, nextCards)));
    }
    setEditingId(null);
    setEditingDraft(BLANK_EDIT_DRAFT);
    setManageMessage("已保存修改。");
  }

  function deleteCard(cardId) {
    setCards(cards.filter((c) => c.id !== cardId));
    setWrongBook(Object.fromEntries(categories.map((cat) => [cat, (wrongBook[cat] ?? []).filter((id) => id !== cardId)])));
    if (editingId === cardId) { setEditingId(null); setEditingDraft(BLANK_EDIT_DRAFT); }
    setManageMessage("已删除词卡。");
  }

  function requestDeleteCard(cardId) {
    const card = cards.find((c) => c.id === cardId);
    setConfirmDialog({ type: "deleteCard", title: "清除词卡？", message: `将清除"${card?.hanzi || "这张词卡"}"。`, confirmLabel: "清除", payload: { cardId } });
  }

  function toggleCardSelection(id) {
    setSelectedCardIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function selectAllFilteredCards() {
    if (selectedCardIds.size === filteredCards.length) setSelectedCardIds(new Set());
    else setSelectedCardIds(new Set(filteredCards.map((c) => c.id)));
  }

  function requestDeleteSelectedCards() {
    const count = selectedCardIds.size;
    if (count === 0) return;
    setConfirmDialog({ type: "deleteSelectedCards", title: `清除 ${count} 张词卡？`, message: `将清除已选的 ${count} 张词卡。`, confirmLabel: "清除", payload: { ids: [...selectedCardIds] } });
  }

  // ── Category CRUD ──

  function addCategory(event) {
    event.preventDefault();
    const name = String(newCategoryForm.value ?? "").trim();
    if (!name) { setManageMessage("请输入新类别名称。"); return; }
    if (categories.includes(name)) { setManageMessage("这个类别已经存在。"); return; }
    setCategories([...categories, name]);
    setNewCategoryForm(BLANK_CATEGORY_FORM);
    setManageMessage(`已添加 ${name}。`);
  }

  function renameCategory(from, toRaw) {
    const to = normalizeCategoryName(toRaw);
    if (!to || from === to || categories.includes(to)) return;
    setCategories(categories.map((c) => (c === from ? to : c)));
    setCards(cards.map((c) => (c.set === from ? { ...c, set: to } : c)));
    const wb = { ...wrongBook }; wb[to] = wb[from] ?? []; delete wb[from];
    setWrongBook(sanitizeWrongBook(wb, cards, categories.map((c) => (c === from ? to : c))));
    const pm = { ...progressMap };
    if (pm[from]) { pm[to] = { ...pm[from], category: to }; delete pm[from]; }
    setProgressMap(pm);
    if (studyCategory === from) setStudyCategory(to);
    setManageMessage(`已把 ${from} 改成 ${to}。`);
  }

  function requestRemoveCategory(name) {
    const count = cards.filter((c) => c.set === name).length;
    setConfirmDialog({
      type: "removeCategory", title: "清除类别？",
      message: count > 0 ? `将清除"${name}"和里面的 ${count} 张。` : `将清除"${name}"。`,
      confirmLabel: "清除", payload: { name },
    });
  }

  function removeCategory(name) {
    setCards(cards.filter((c) => c.set !== name));
    setCategories(categories.filter((c) => c !== name));
    const wb = { ...wrongBook }; delete wb[name];
    setWrongBook(sanitizeWrongBook(wb, cards.filter((c) => c.set !== name), categories.filter((c) => c !== name)));
    const pm = { ...progressMap };
    if (pm[name]) { delete pm[name]; setProgressMap(pm); if (studyCategory === name) { setStudyCategory(null); setStudyMessage("原来的类别已清除。"); } }
    setManageMessage(`已清除 ${name}。`);
  }

  // ── Import / Export ──

  function importCards(event) {
    event.preventDefault();
    const category = getCategoryChoice(importForm.category, newCategoryForm.value);
    if (!category) { setManageMessage("请选择类别或添加类别。"); return; }
    const preview = buildImportPreview(importForm.text);
    if (preview.length === 0) { setManageMessage("请先输入汉字，每行一个。"); return; }
    ensureCategoryExists(category);
    const newCards = preview.map((item) => ({ id: makeId(), set: category, hanzi: item.hanzi, pinyin: item.pinyin }));
    setCards([...newCards, ...cards]);
    setImportForm({ ...BLANK_IMPORT_FORM, category });
    setNewCategoryForm(BLANK_CATEGORY_FORM);
    setManageMessage(`已导入 ${newCards.length} 张。`);
  }

  function handleFileUpload(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      try {
        const parsed = JSON.parse(text);
        if (parsed.cards && parsed.version) { restoreBackup(text); return; }
      } catch { /* not JSON, treat as text */ }
      setImportForm((prev) => ({ ...prev, text }));
      setManageMessage("已读取文件内容。");
    };
    reader.readAsText(file);
  }

  function restoreBackup(text) {
    const value = String(text ?? "").trim();
    if (!value) { setManageMessage("没有可恢复的内容。"); return; }
    try {
      const parsed = JSON.parse(value);
      const nextCards = sanitizeCards(Array.isArray(parsed) ? parsed : normalizeImportedCards(parsed.cards ?? [], DEFAULT_CATEGORIES[0]));
      const nextCategories = sanitizeCategories(parsed.categories ?? starterCategories, nextCards);
      setCards(nextCards);
      setCategories(nextCategories);
      setWrongBook(sanitizeWrongBook(parsed.wrongBook ?? {}, nextCards, nextCategories));
      const nextPM = sanitizeProgressMap(parsed.progress ?? null, nextCards, nextCategories);
      setProgressMap(nextPM);
      setStudyCategory(Object.keys(nextPM)[0] ?? null);
      setStudyOptions(sanitizeStudyOptions(parsed.studyOptions ?? BLANK_STUDY_OPTIONS));
      setManageMessage(`已恢复 ${nextCards.length} 张。`);
    } catch { setManageMessage("备份内容格式不正确。"); }
  }

  function prepareExport() {
    const backup = exportBackup(cards, categories, wrongBook, progressMap, studyOptions);
    setExportText(backup);
    const blob = new Blob([backup], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "拼音卡-backup.json"; a.click();
    URL.revokeObjectURL(url);
    setManageMessage("已下载备份。");
  }

  // ── Confirm dialog ──

  function confirmDialogAction() {
    if (!confirmDialog) return;
    if (confirmDialog.type === "deleteCard") deleteCard(confirmDialog.payload.cardId);
    if (confirmDialog.type === "deleteSelectedCards") {
      const ids = new Set(confirmDialog.payload.ids);
      setCards((prev) => prev.filter((c) => !ids.has(c.id)));
      setWrongBook((prev) => Object.fromEntries(Object.entries(prev).map(([cat, cIds]) => [cat, cIds.filter((id) => !ids.has(id))])));
      setSelectedCardIds(new Set());
      setManageMessage(`已删除 ${ids.size} 张词卡。`);
    }
    if (confirmDialog.type === "removeCategory") removeCategory(confirmDialog.payload.name);
    if (confirmDialog.type === "clearProgress") {
      const cat = confirmDialog.payload?.category;
      if (cat) { const pm = { ...progressMap }; delete pm[cat]; setProgressMap(pm); if (studyCategory === cat) setStudyCategory(null); }
      else { setProgressMap({}); setStudyCategory(null); }
      setStudyMessage("");
    }
    setConfirmDialog(null);
  }

  // ── CLI (Command Palette) ──

  useEffect(() => {
    function handleGlobalKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setCliOpen((c) => !c); return; }
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      if (e.key === "/" && !cliOpen) { e.preventDefault(); setCliOpen(true); }
    }
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [cliOpen]);

  const cliActions = useMemo(() => ({
    quickAdd(text) {
      const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return "请输入汉字。";
      const targetCat = categories[0] || DEFAULT_CATEGORIES[0];
      const newCards = lines.map((hanzi) => ({ id: makeId(), set: targetCat, hanzi, pinyin: generatePinyin(hanzi) }));
      setCards((prev) => [...newCards, ...prev]);
      return `已添加 ${newCards.length} 张到 ${targetCat}。`;
    },
    startStudy(categoryArg) {
      const cat = categoryArg
        ? (categoryArg === "all" || categoryArg === "全部" ? ALL_CATEGORY : categories.find((c) => c === categoryArg || c.includes(categoryArg)))
        : (lastStudiedCategory || ALL_CATEGORY);
      if (!cat && categoryArg) return `找不到类别: "${categoryArg}"`;
      const target = cat || ALL_CATEGORY;
      startStudy(target);
      return `开始学习: ${target === ALL_CATEGORY ? "全部" : target}`;
    },
    search(keyword) {
      const lower = keyword.toLowerCase();
      return cards.filter((c) => [c.set, c.hanzi, c.pinyin].join(" ").toLowerCase().includes(lower));
    },
    toggleShuffle() {
      toggleStudyOption("shuffle");
      return studyOptions.shuffle ? "随机顺序: 关" : "随机顺序: 开";
    },
    toggleOnlyWrong() {
      toggleStudyOption("onlyWrong");
      return studyOptions.onlyWrong ? "只学不会: 关" : "只学不会: 开";
    },
    exportBackup() { prepareExport(); },
    getStats() {
      const total = cards.length;
      const catCount = categories.length;
      const allWrong = new Set(Object.values(wrongBook).flat()).size;
      const inProgress = Object.keys(progressMap).length;
      const lines = [
        `词卡总数: ${total}`,
        `类别数量: ${catCount}`,
        `不会的词: ${allWrong}`,
        `进行中: ${inProgress}`,
        "",
        ...categories.map((cat) => {
          const count = cards.filter((c) => c.set === cat).length;
          const wrong = (wrongBook[cat] || []).length;
          return `  ${cat}: ${count}张${wrong > 0 ? ` (不会${wrong})` : ""}`;
        }),
      ];
      return lines.join("\n");
    },
    goToTab(t) { setTab(t); setManageMessage(""); },
    getCategories() {
      return categories.map((cat) => ({
        name: cat,
        count: cards.filter((c) => c.set === cat).length,
        wrongCount: (wrongBook[cat] || []).length,
      }));
    },
    clearProgress() {
      setProgressMap({});
      setStudyCategory(null);
      setStudyMessage("");
    },
  }), [cards, categories, wrongBook, progressMap, studyOptions, lastStudiedCategory]);

  // ── Cross-linking: jump between tabs ──

  function goToCardsFiltered(category) {
    setFilterCategory(category === ALL_CATEGORY ? "全部" : category);
    setTab("cards");
  }

  function studyFromCards() {
    const cat = filterCategory === "全部" ? ALL_CATEGORY : filterCategory;
    startStudy(cat);
  }

  // ── Render ──

  if (isStudying) {
    return (
      <div className="app-shell">
        <StudySession
          progress={progress}
          currentCard={currentCard}
          roundDone={roundDone}
          studyMessage={studyMessage}
          cardsById={cardsById}
          handwritingEnabled={studyOptions.handwriting}
          onExit={exitStudy}
          onReveal={revealCard}
          onMark={markCard}
          onContinueNextRound={continueNextRound}
          onRestartRound={restartRound}
          onGoToPreviousCard={goToPreviousCard}
          onDeleteCurrentCard={requestDeleteCard}
          onGoToCards={goToCardsFiltered}
        />
        <ConfirmDialog dialog={confirmDialog} onCancel={() => setConfirmDialog(null)} onConfirm={confirmDialogAction} />
        <CommandPalette open={cliOpen} onClose={() => setCliOpen(false)} actions={cliActions} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="app-content">
        {tab === "study" && (
          <StudyTab
            summaries={setSummaries}
            allSummary={allSummary}
            lastStudiedCategory={lastStudiedCategory}
            studyOptions={studyOptions}
            onToggleOption={toggleStudyOption}
            onStartStudy={startStudy}
            onContinueStudy={continueStudy}
            onRestartProgress={restartStudyProgress}
            onGoToCards={goToCardsFiltered}
          />
        )}
        {tab === "cards" && (
          <CardsTab
            categories={categories}
            filteredCards={filteredCards}
            allCards={cards}
            search={search}
            filterCategory={filterCategory}
            editingId={editingId}
            editingDraft={editingDraft}
            selectedCardIds={selectedCardIds}
            manageMessage={manageMessage}
            onChangeSearch={setSearch}
            onChangeFilterCategory={setFilterCategory}
            onStartEditing={startEditing}
            onChangeEditingDraft={setEditingDraft}
            onSaveEdit={saveEdit}
            onCancelEdit={() => { setEditingId(null); setEditingDraft(BLANK_EDIT_DRAFT); }}
            onDeleteCard={requestDeleteCard}
            onToggleCardSelection={toggleCardSelection}
            onSelectAllCards={selectAllFilteredCards}
            onDeleteSelectedCards={requestDeleteSelectedCards}
            onShowAddSheet={() => setShowAddSheet(true)}
            onStudyFromCards={studyFromCards}
          />
        )}
        {tab === "more" && (
          <MoreTab
            categories={categories}
            allCards={cards}
            importForm={importForm}
            importPreview={importPreview}
            newCategoryForm={newCategoryForm}
            exportText={exportText}
            manageMessage={manageMessage}
            addForm={addForm}
            addPreviewPinyin={addPreviewPinyin}
            onChangeAddForm={setAddForm}
            onChangeImportForm={setImportForm}
            onChangeNewCategoryForm={setNewCategoryForm}
            onAddCategory={addCategory}
            onRenameCategory={renameCategory}
            onRemoveCategory={requestRemoveCategory}
            onImportCards={importCards}
            onFileUpload={handleFileUpload}
            onPrepareExport={prepareExport}
            onChangeExportText={setExportText}
            onRestoreBackup={restoreBackup}
            onSubmitAddCard={submitAddCard}
          />
        )}
      </div>

      <BottomTabBar tab={tab} onChangeTab={(t) => { setTab(t); setManageMessage(""); }} />

      {showAddSheet && (
        <AddSheet
          categories={categories}
          addForm={addForm}
          addPreviewPinyin={addPreviewPinyin}
          newCategoryForm={newCategoryForm}
          manageMessage={manageMessage}
          onChangeAddForm={setAddForm}
          onChangeNewCategoryForm={setNewCategoryForm}
          onSubmitAddCard={(e) => { submitAddCard(e); }}
          onClose={() => setShowAddSheet(false)}
        />
      )}

      <ConfirmDialog dialog={confirmDialog} onCancel={() => setConfirmDialog(null)} onConfirm={confirmDialogAction} />
      <CommandPalette open={cliOpen} onClose={() => setCliOpen(false)} actions={cliActions} />
      {tab === "study" && <CliTriggerHint onClick={() => setCliOpen(true)} />}
      <footer className="site-footer">Kyoii 制作</footer>
    </div>
  );
}

// ── Bottom Tab Bar ──

function BottomTabBar({ tab, onChangeTab }) {
  return (
    <nav className="tab-bar">
      <button className={`tab-item ${tab === "study" ? "active" : ""}`} type="button" onClick={() => onChangeTab("study")}>
        <svg viewBox="0 0 24 24"><path d="M12 3 1 9l4 2.2v6l7 4 7-4v-6L23 9l-11-6Zm0 14.5-5-2.7V13l5 2.7 5-2.7v1.8l-5 2.7Z" /></svg>
        <span>学习</span>
      </button>
      <button className={`tab-item ${tab === "cards" ? "active" : ""}`} type="button" onClick={() => onChangeTab("cards")}>
        <svg viewBox="0 0 24 24"><path d="M4 6h16v2H4V6Zm2-3h12v2H6V3Zm-2 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H4Zm0 2h16v8H4v-8Z" /></svg>
        <span>词卡</span>
      </button>
      <button className={`tab-item ${tab === "more" ? "active" : ""}`} type="button" onClick={() => onChangeTab("more")}>
        <svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" /></svg>
        <span>更多</span>
      </button>
    </nav>
  );
}

// ── Study Tab ──

function StudyTab({ summaries, allSummary, lastStudiedCategory, studyOptions, onToggleOption, onStartStudy, onContinueStudy, onRestartProgress, onGoToCards }) {
  return (
    <main className="page study-page">
      <header className="page-header-center">
        <h1>拼音卡</h1>
        <p className="subtitle">看拼音，练汉字</p>
      </header>

      <div className="option-row">
        <button className={`option-pill ${studyOptions.handwriting ? "active" : ""}`} type="button" onClick={() => onToggleOption("handwriting")}>手写</button>
        <button className={`option-pill ${studyOptions.shuffle ? "active" : ""}`} type="button" onClick={() => onToggleOption("shuffle")}>随机</button>
        <button className={`option-pill ${studyOptions.onlyWrong ? "active" : ""}`} type="button" onClick={() => onToggleOption("onlyWrong")}>只学不会</button>
      </div>

      <section className="category-grid">
        <CategoryCard summary={allSummary} label="全部" isAll onStart={onStartStudy} onContinue={onContinueStudy} onRestart={onRestartProgress} onGoToCards={onGoToCards} />
        {summaries.map((s) => (
          <CategoryCard key={s.category} summary={s} label={s.category} lastStudied={lastStudiedCategory === s.category} onStart={onStartStudy} onContinue={onContinueStudy} onRestart={onRestartProgress} onGoToCards={onGoToCards} />
        ))}
      </section>
    </main>
  );
}

function CategoryCard({ summary, label, isAll, lastStudied, onStart, onContinue, onRestart, onGoToCards }) {
  const { category, count, wrongCount, progress } = summary;
  const inProgress = Boolean(progress);
  const pct = inProgress && progress.currentIds.length > 0 ? Math.min((progress.index / progress.currentIds.length) * 100, 100) : 0;

  return (
    <div className={`cat-card ${isAll ? "cat-card-all" : ""} ${inProgress ? "cat-card-active" : ""}`}>
      <button className="cat-card-main" type="button" onClick={() => (inProgress ? onContinue(category) : onStart(category))}>
        <div className="cat-card-text">
          {lastStudied && <span className="cat-kicker">最近学习</span>}
          <h2>{label}</h2>
          <span className="cat-meta">{count} 张</span>
        </div>
        {!inProgress && wrongCount > 0 && <span className="cat-badge">不会 {wrongCount}</span>}
      </button>

      {inProgress && (
        <div className="cat-progress">
          <div className="cat-progress-header">
            <span className="round-chip">第 {progress.round} 轮</span>
            <span className="cat-progress-text">{Math.min(progress.index + 1, progress.currentIds.length)} / {progress.currentIds.length}</span>
          </div>
          <div className="progress-track"><span style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      <div className="cat-card-actions">
        {inProgress && (
          <button className="icon-btn" type="button" aria-label="重来" onClick={(e) => { e.stopPropagation(); onRestart(category); }}>
            <svg viewBox="0 0 24 24"><path d="M12 5a7 7 0 1 1-6.7 9h2.1A5 5 0 1 0 8 8.9L10.2 11H4V4.8L6.6 7.4A6.95 6.95 0 0 1 12 5Z" /></svg>
          </button>
        )}
        <button className="icon-btn" type="button" aria-label="管理" onClick={(e) => { e.stopPropagation(); onGoToCards(category); }}>
          <svg viewBox="0 0 24 24"><path d="m16.9 3.5 3.6 3.6-11 11L6 18l-.1-3.5 11-11ZM5 20h14v-2H5v2Z" /></svg>
        </button>
      </div>
    </div>
  );
}

// ── Study Session (fullscreen) ──

function StudySession({ progress, currentCard, roundDone, studyMessage, cardsById, handwritingEnabled, onExit, onReveal, onMark, onContinueNextRound, onRestartRound, onGoToPreviousCard, onDeleteCurrentCard, onGoToCards }) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [drawingKey, setDrawingKey] = useState(0);
  const [drawingScore, setDrawingScore] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(true);
  const autoAdvanceRef = useRef(null);
  const progressValue = progress && progress.currentIds.length > 0 ? Math.min((progress.index / progress.currentIds.length) * 100, 100) : 0;

  useEffect(() => { setDrawingKey((k) => k + 1); setDrawingScore(null); if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current); }, [currentCard?.id]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 721px)");
    const sync = () => setIsDesktop(mq.matches);
    sync(); mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Fade out shortcut hint after 8s
  useEffect(() => {
    if (!isDesktop) return;
    const t = setTimeout(() => setShowShortcuts(false), 8000);
    return () => clearTimeout(t);
  }, [isDesktop]);

  useEffect(() => {
    function handleKey(e) {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === "q") { e.preventDefault(); onExit(); return; }
      if (k === "h") { e.preventDefault(); setShowShortcuts((v) => !v); return; }
      if (roundDone) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onContinueNextRound(); } return; }
      if (!progress || !currentCard) return;
      if (e.key === "ArrowUp" || e.key === " ") { e.preventDefault(); onReveal(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); if (progress.revealed) { setDrawingScore(null); onMark(true); } }
      else if (e.key === "ArrowDown") { e.preventDefault(); if (progress.revealed) { setDrawingScore(null); onMark(false); } }
      else if (e.key === "ArrowLeft" && progress.history?.length > 0) { e.preventDefault(); onGoToPreviousCard(); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentCard, onContinueNextRound, onExit, onGoToPreviousCard, onMark, onReveal, progress, roundDone]);

  const displayCategory = progress?.category === ALL_CATEGORY ? "全部" : progress?.category;
  const useHandwriting = handwritingEnabled && !progress?.revealed;

  return (
    <main className="study-session">
      <header className="session-header">
        <button className="back-btn" type="button" onClick={onExit} aria-label="退出">
          <svg viewBox="0 0 24 24"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12l4.58-4.59Z" /></svg>
        </button>
        {progress ? (
          <div className="session-title">
            <h1>{displayCategory}</h1>
            <span className="session-meta">第 {progress.round} 轮 · {Math.min(progress.index + 1, progress.currentIds.length)} / {progress.currentIds.length}</span>
          </div>
        ) : (
          <div className="session-title"><h1>学习</h1></div>
        )}
      </header>

      {progress && (
        <div className="session-progress-row">
          {progress.history?.length > 0 ? (
            <button className="prev-btn" type="button" aria-label="上一张" onClick={onGoToPreviousCard}>
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12.5 8c-2.65 0-5.05 1.04-6.83 2.73L3 8v9h9l-2.83-2.83A7.95 7.95 0 0 1 12.5 10c3.04 0 5.64 1.71 6.96 4.21l1.77-.77A9.96 9.96 0 0 0 12.5 8Z"/></svg>
            </button>
          ) : (
            <div className="prev-btn-spacer" />
          )}
          <div className="session-progress-bar"><span style={{ width: `${progressValue}%` }} /></div>
        </div>
      )}

      {progress && currentCard && (
        <>
          {useHandwriting ? (
            <DrawingCanvas
              key={drawingKey}
              expectedHanzi={currentCard.hanzi}
              onResult={(score) => {
                setDrawingScore(score);
                onReveal();
                // Brief pause to see correct overlay, then auto-advance on good score
                if (score >= 75) {
                  autoAdvanceRef.current = setTimeout(() => { setDrawingScore(null); onMark(true); }, 1800);
                }
              }}
              onClose={() => onReveal()}
            />
          ) : !progress.revealed ? (
            <div className="flashcard-shell">
              <button className="flashcard" type="button" onClick={onReveal}>
                <div className="flashcard-pinyin">{currentCard.pinyin}</div>
                <div className="flashcard-hanzi flashcard-tap-hint">点击翻看</div>
              </button>
            </div>
          ) : null}

          {progress.revealed && (
            <>
              <div className="flashcard-shell">
                <div className="flashcard revealed">
                  <div className="flashcard-pinyin">{currentCard.pinyin}</div>
                  <div className="flashcard-hanzi">{currentCard.hanzi || "（未填写）"}</div>
                  {progress.category === ALL_CATEGORY && (
                    <button className="flashcard-cat-link" type="button" onClick={() => { onGoToCards(currentCard.set); onExit(); }}>
                      {currentCard.set}
                    </button>
                  )}
                </div>
              </div>

              {drawingScore !== null && (
                <div className={`drawing-result-banner ${drawingScore >= 55 ? "good" : "retry"}`}>
                  <span className="drawing-score">{drawingScore}%</span>
                  <span>{drawingScore >= 75 ? "写对" : drawingScore >= 55 ? "接近" : "再练练"}</span>
                  {drawingScore >= 75 && <span className="drawing-auto-hint">自动下一张...</span>}
                </div>
              )}

              <div className="answer-row">
                <button className="answer-btn answer-wrong" type="button" onClick={() => { if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current); setDrawingScore(null); onMark(false); }}>✕</button>
                <button className="answer-btn answer-right" type="button" onClick={() => { if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current); setDrawingScore(null); onMark(true); }}>✓</button>
              </div>
            </>
          )}
        </>
      )}

      {progress && roundDone && (
        <section className="round-done-panel">
          <h2>下一轮</h2>
          <p>还剩 {progress.wrongIdsNextRound.length} 张。</p>
          <div className="round-done-actions">
            <button className="btn-secondary" type="button" onClick={onRestartRound}>重来</button>
            <button className="btn-primary" type="button" onClick={onContinueNextRound}>下一轮</button>
          </div>
        </section>
      )}

      {!progress && (
        <section className="round-done-panel">
          <h2>{studyMessage || "现在没有进行中的学习。"}</h2>
          <button className="btn-secondary" type="button" onClick={onExit}>返回</button>
        </section>
      )}

      {isDesktop && (
        <div className={`shortcut-bar ${showShortcuts ? "" : "faded"}`}>
          <span><kbd>←</kbd> 上一张</span>
          <span><kbd>→</kbd> 会</span>
          <span><kbd>↓</kbd> 不会</span>
          <span><kbd>Q</kbd> 退出</span>
          <span><kbd>H</kbd> {showShortcuts ? "隐藏" : "显示"}</span>
        </div>
      )}
    </main>
  );
}

// ── Cards Tab ──

function CardsTab({ categories, filteredCards, allCards, search, filterCategory, editingId, editingDraft, selectedCardIds, manageMessage, onChangeSearch, onChangeFilterCategory, onStartEditing, onChangeEditingDraft, onSaveEdit, onCancelEdit, onDeleteCard, onToggleCardSelection, onSelectAllCards, onDeleteSelectedCards, onShowAddSheet, onStudyFromCards }) {
  const checkboxRef = useRef(null);
  const allSelected = filteredCards.length > 0 && selectedCardIds.size === filteredCards.length;
  const someSelected = selectedCardIds.size > 0 && !allSelected;

  useEffect(() => { if (checkboxRef.current) checkboxRef.current.indeterminate = someSelected; }, [someSelected]);

  return (
    <main className="page cards-page">
      <header className="page-header-row">
        <h1>词卡</h1>
        <div className="header-actions">
          {filterCategory !== "全部" && (
            <button className="btn-text" type="button" onClick={onStudyFromCards}>学习此组</button>
          )}
          <button className="btn-add" type="button" onClick={onShowAddSheet} aria-label="添加词卡">+</button>
        </div>
      </header>

      {manageMessage && <p className="toast">{manageMessage}</p>}

      <div className="search-bar">
        <input value={search} onChange={(e) => onChangeSearch(e.target.value)} placeholder="搜索词卡..." />
      </div>

      <div className="filter-pills">
        <button className={`pill ${filterCategory === "全部" ? "active" : ""}`} type="button" onClick={() => onChangeFilterCategory("全部")}>全部</button>
        {categories.map((cat) => (
          <button key={cat} className={`pill ${filterCategory === cat ? "active" : ""}`} type="button" onClick={() => onChangeFilterCategory(cat)}>{cat}</button>
        ))}
      </div>

      <div className="select-bar">
        <label className="select-all-label">
          <input ref={checkboxRef} type="checkbox" checked={allSelected} onChange={onSelectAllCards} />
          <span>全选 ({filteredCards.length})</span>
        </label>
        {selectedCardIds.size > 0 && (
          <button className="btn-danger-sm" type="button" onClick={onDeleteSelectedCards}>删除 {selectedCardIds.size} 张</button>
        )}
      </div>

      <div className="card-list">
        {filteredCards.map((card) =>
          editingId === card.id ? (
            <div className="card-row editing" key={card.id}>
              <label>类别
                <select value={editingDraft.set} onChange={(e) => onChangeEditingDraft({ ...editingDraft, set: e.target.value })}>
                  {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </label>
              <label>汉字
                <input value={editingDraft.hanzi} onChange={(e) => onChangeEditingDraft({ ...editingDraft, hanzi: e.target.value, pinyin: editingDraft.pinyin && editingDraft.pinyin !== generatePinyin(editingDraft.hanzi) ? editingDraft.pinyin : generatePinyin(e.target.value) })} />
              </label>
              <label>拼音
                <input value={editingDraft.pinyin} onChange={(e) => onChangeEditingDraft({ ...editingDraft, pinyin: e.target.value })} />
              </label>
              <div className="card-row-actions">
                <button className="btn-primary" type="button" onClick={onSaveEdit}>保存</button>
                <button className="btn-secondary" type="button" onClick={onCancelEdit}>取消</button>
              </div>
            </div>
          ) : (
            <div className={`card-row ${selectedCardIds.has(card.id) ? "selected" : ""}`} key={card.id}>
              <input type="checkbox" className="card-check" checked={selectedCardIds.has(card.id)} onChange={() => onToggleCardSelection(card.id)} />
              <button className="card-row-content" type="button" onClick={() => onStartEditing(card)}>
                <span className="card-row-cat">{card.set}</span>
                <strong className="card-row-hanzi">{card.hanzi || "（未填写）"}</strong>
                <span className="card-row-pinyin">{card.pinyin || "（未填写）"}</span>
              </button>
              <button className="icon-btn-danger" type="button" aria-label="删除" onClick={() => onDeleteCard(card.id)}>
                <svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v7h-2v-7Zm4 0h2v7h-2v-7ZM7 10h2v7H7v-7Zm1 10h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2Z" /></svg>
              </button>
            </div>
          ),
        )}
        {filteredCards.length === 0 && <p className="empty-msg">没有找到词卡。</p>}
      </div>
    </main>
  );
}

// ── Add Sheet (Modal) ──

function AddSheet({ categories, addForm, addPreviewPinyin, newCategoryForm, manageMessage, onChangeAddForm, onChangeNewCategoryForm, onSubmitAddCard, onClose }) {
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>添加词卡</h2>
          <button className="btn-text" type="button" onClick={onClose}>完成</button>
        </div>

        {manageMessage && <p className="toast">{manageMessage}</p>}

        <form className="sheet-form" onSubmit={onSubmitAddCard}>
          <CategoryChooser
            categories={categories}
            value={addForm.category}
            onValueChange={(v) => onChangeAddForm({ ...addForm, category: v })}
            newValue={newCategoryForm.value}
            onNewValueChange={(v) => onChangeNewCategoryForm({ value: v })}
          />
          <label>
            汉字（每行一个）
            <textarea rows={4} value={addForm.hanzi} onChange={(e) => onChangeAddForm({ ...addForm, hanzi: e.target.value, pinyin: e.target.value.split("\n").map((l) => (l.trim() ? generatePinyin(l.trim()) : "")).join("\n") })} placeholder="每行一个词" />
          </label>
          <label>
            拼音（自动生成）
            <textarea rows={4} value={addForm.pinyin || addPreviewPinyin} onChange={(e) => onChangeAddForm({ ...addForm, pinyin: e.target.value })} placeholder="自动" />
          </label>
          <button className="btn-primary full-width" type="submit">添加词卡</button>
        </form>
      </div>
    </div>
  );
}

// ── More Tab ──

function MoreTab({ categories, allCards, importForm, importPreview, newCategoryForm, exportText, manageMessage, onChangeImportForm, onChangeNewCategoryForm, onAddCategory, onRenameCategory, onRemoveCategory, onImportCards, onFileUpload, onPrepareExport, onChangeExportText, onRestoreBackup }) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFileUpload(file);
  }

  return (
    <main className="page more-page">
      <header className="page-header-center">
        <h1>更多</h1>
      </header>

      {manageMessage && <p className="toast">{manageMessage}</p>}

      {/* Categories */}
      <section className="settings-card">
        <h2>类别管理</h2>
        <div className="cat-list">
          {categories.map((cat) => (
            <CategoryRow key={cat} category={cat} cardCount={allCards.filter((c) => c.set === cat).length} onRename={onRenameCategory} onRemove={onRemoveCategory} />
          ))}
        </div>
        <form className="inline-form" onSubmit={onAddCategory}>
          <input value={newCategoryForm.value} onChange={(e) => onChangeNewCategoryForm({ value: e.target.value })} placeholder="新类别名称" />
          <button className="btn-primary" type="submit">添加</button>
        </form>
      </section>

      {/* Import */}
      <section className="settings-card">
        <h2>导入</h2>
        <form className="import-form" onSubmit={onImportCards}>
          <CategoryChooser
            categories={categories}
            value={importForm.category}
            onValueChange={(v) => onChangeImportForm({ ...importForm, category: v })}
            newValue={newCategoryForm.value}
            onNewValueChange={(v) => onChangeNewCategoryForm({ value: v })}
          />

          <div className={`drop-zone ${dragOver ? "drag-over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()}>
            <input ref={fileInputRef} type="file" accept=".json,.txt" style={{ display: "none" }} onChange={(e) => { onFileUpload(e.target.files[0]); e.target.value = ""; }} />
            <p>拖放文件或点击上传</p>
            <span className="drop-zone-hint">.json 备份 或 .txt 词汇表</span>
          </div>

          <label>
            或粘贴汉字（每行一条）
            <textarea rows={6} value={importForm.text} onChange={(e) => onChangeImportForm({ ...importForm, text: e.target.value })} placeholder="每行一个" />
          </label>

          {importPreview.length > 0 && (
            <div className="preview-box">
              {importPreview.map((item, i) => (
                <div className="preview-row" key={`${item.hanzi}-${i}`}>
                  <strong>{item.hanzi}</strong>
                  <span>{item.pinyin}</span>
                </div>
              ))}
            </div>
          )}
          <button className="btn-primary full-width" type="submit">导入词卡</button>
        </form>
      </section>

      {/* Export */}
      <section className="settings-card">
        <h2>导出 / 备份</h2>
        <button className="btn-primary full-width" type="button" onClick={onPrepareExport}>下载备份</button>
        <label>
          粘贴备份内容恢复
          <textarea rows={6} value={exportText} onChange={(e) => onChangeExportText(e.target.value)} placeholder="粘贴备份" />
        </label>
        <button className="btn-secondary full-width" type="button" onClick={() => onRestoreBackup(exportText)}>恢复</button>
      </section>
    </main>
  );
}

// ── Shared Components ──

function CategoryChooser({ categories, value, newValue, onValueChange, onNewValueChange }) {
  return (
    <div className="chooser">
      <label>
        选择类别
        <select value={value} onChange={(e) => onValueChange(e.target.value)}>
          {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          <option value="__new__">+ 添加类别</option>
        </select>
      </label>
      {value === "__new__" && (
        <label>
          新类别名称
          <input value={newValue} onChange={(e) => onNewValueChange(e.target.value)} placeholder="第五周" />
        </label>
      )}
    </div>
  );
}

function CategoryRow({ category, cardCount, onRename, onRemove }) {
  const [draft, setDraft] = useState(category);
  useEffect(() => { setDraft(category); }, [category]);

  return (
    <div className="cat-row">
      <div className="cat-row-info">
        <strong>{category}</strong>
        <span>{cardCount} 张</span>
      </div>
      <div className="cat-row-actions">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn-secondary" type="button" onClick={() => onRename(category, draft)}>改名</button>
        <button className="icon-btn-danger" type="button" aria-label="删除" onClick={() => onRemove(category)}>
          <svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v7h-2v-7Zm4 0h2v7h-2v-7ZM7 10h2v7H7v-7Zm1 10h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2Z" /></svg>
        </button>
      </div>
    </div>
  );
}

function CliTriggerHint({ onClick }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(t);
  }, []);
  return (
    <button className={`cli-trigger-hint ${visible ? "" : "cli-trigger-faded"}`} type="button" onClick={onClick}>
      <kbd>⌘K</kbd> 命令
    </button>
  );
}

function ConfirmDialog({ dialog, onCancel, onConfirm }) {
  if (!dialog) return null;
  return (
    <div className="sheet-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true">
        <h2>{dialog.title}</h2>
        <p>{dialog.message}</p>
        <div className="modal-actions">
          <button className="btn-secondary" type="button" onClick={onCancel}>取消</button>
          <button className="btn-danger" type="button" onClick={onConfirm}>{dialog.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export default App;
