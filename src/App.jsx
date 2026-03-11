import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CATEGORIES, starterCards, starterCategories } from "./data/starterCards";
import { generatePinyin } from "./lib/pinyin";

const LEGACY_CATEGORY_NAMES = {
  听写订正: "订正",
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

const MANAGE_SECTIONS = [
  { id: "menu", label: "管理词卡", shortLabel: "词卡", icon: "grid" },
  { id: "add", label: "添加", shortLabel: "添加", icon: "plus" },
  { id: "categories", label: "类别", shortLabel: "类别", icon: "tag" },
  { id: "edit", label: "编辑", shortLabel: "编辑", icon: "edit" },
  { id: "import", label: "导入", shortLabel: "导入", icon: "import" },
  { id: "export", label: "导出", shortLabel: "导出", icon: "export" },
];

const BLANK_STUDY_OPTIONS = {
  shuffle: false,
  onlyWrong: false,
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

function readStorage(key, fallback) {
  try {
    const keys = [key, ...(STORAGE_KEY_FALLBACKS[key] ?? [])];
    for (const storageKey of keys) {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        return JSON.parse(raw);
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function shuffleArray(items) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function orderIds(ids, shouldShuffle, orderLookup) {
  const next = [...ids];
  if (shouldShuffle) {
    return shuffleArray(next);
  }

  return next.sort(
    (leftId, rightId) =>
      (orderLookup[leftId] ?? Number.MAX_SAFE_INTEGER) -
      (orderLookup[rightId] ?? Number.MAX_SAFE_INTEGER),
  );
}

function reorderCurrentIds(ids, index, shouldShuffle, orderLookup) {
  const safeIndex = Math.min(Math.max(0, Number(index) || 0), ids.length);
  const answeredIds = ids.slice(0, safeIndex);
  if (safeIndex >= ids.length) {
    return answeredIds;
  }

  const currentId = ids[safeIndex];
  const queuedIds = orderIds(ids.slice(safeIndex + 1), shouldShuffle, orderLookup);
  return [...answeredIds, currentId, ...queuedIds];
}

function reorderProgressItem(progress, shouldShuffle, orderLookup) {
  return {
    ...progress,
    shuffle: shouldShuffle,
    currentIds: reorderCurrentIds(
      progress.currentIds ?? [],
      progress.index ?? 0,
      shouldShuffle,
      orderLookup,
    ),
    wrongIdsNextRound: orderIds(progress.wrongIdsNextRound ?? [], shouldShuffle, orderLookup),
  };
}

function uniqueCategories(values) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeCategoryName(value))
        .filter(Boolean),
    ),
  );
}

function normalizeCategoryName(value) {
  const name = String(value ?? "").trim();
  return LEGACY_CATEGORY_NAMES[name] ?? name;
}

function sanitizeCategories(categories, cards) {
  return uniqueCategories([
    ...(categories ?? []),
    ...cards.map((card) => card.set),
  ]);
}

function sanitizeWrongBook(wrongBook, cards, categories) {
  const cardIds = new Set(cards.map((card) => card.id));
  return Object.fromEntries(
    categories.map((category) => [
      category,
      uniqueCategories(wrongBook?.[category] ?? []).filter((cardId) => cardIds.has(cardId)),
    ]),
  );
}

function sanitizeStudyOptions(options) {
  return {
    shuffle: Boolean(options?.shuffle),
    onlyWrong: Boolean(options?.onlyWrong),
  };
}

function sanitizeCards(cards) {
  return (cards ?? []).map((card, index) => ({
    id: card.id || `starter-${index + 1}`,
    set: normalizeCategoryName(card.set ?? DEFAULT_CATEGORIES[0]) || DEFAULT_CATEGORIES[0],
    pinyin: String(card.pinyin ?? "").trim(),
    hanzi: String(card.hanzi ?? "").trim(),
  }));
}

function sanitizeProgressItem(progress, cards, categories) {
  if (!progress?.category) {
    return null;
  }

  const category = normalizeCategoryName(progress.category);
  if (!categories.includes(category)) {
    return null;
  }

  const cardIds = new Set(cards.map((card) => card.id));
  const currentIds = (progress.currentIds ?? []).filter((cardId) => cardIds.has(cardId));
  const wrongIdsNextRound = (progress.wrongIdsNextRound ?? []).filter((cardId) =>
    cardIds.has(cardId),
  );
  const history = Array.isArray(progress.history)
    ? progress.history
        .filter((entry) => cardIds.has(entry.cardId))
        .map((entry) => ({
          cardId: entry.cardId,
          knew: Boolean(entry.knew),
          prevWasWrong: Boolean(entry.prevWasWrong),
        }))
    : [];

  if (currentIds.length === 0 && wrongIdsNextRound.length === 0) {
    return null;
  }

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
    const singleProgress = sanitizeProgressItem(progressMap, cards, categories);
    return singleProgress ? { [singleProgress.category]: singleProgress } : {};
  }

  return Object.fromEntries(
    Object.entries(progressMap)
      .map(([category, value]) => [
        normalizeCategoryName(category),
        sanitizeProgressItem({ ...value, category }, cards, categories),
      ])
      .filter(([, value]) => Boolean(value)),
  );
}

function exportBackup(cards, categories, wrongBook, progressMap, studyOptions) {
  return JSON.stringify(
    {
      version: 2,
      exportedAt: new Date().toISOString(),
      cards,
      categories,
      wrongBook,
      progress: progressMap,
      studyOptions,
    },
    null,
    2,
  );
}

function normalizeImportedCards(cards, fallbackCategory) {
  return cards
    .map((card) => {
      const hanzi = String(card.hanzi ?? "").trim();
      const pinyin = String(card.pinyin ?? "").trim() || generatePinyin(hanzi);
      return {
        id: card.id || makeId(),
        set: normalizeCategoryName(card.set ?? fallbackCategory) || fallbackCategory,
        pinyin,
        hanzi,
      };
    })
    .filter((card) => card.hanzi);
}

function getCategoryChoice(selectedCategory, newCategory) {
  if (selectedCategory === "__new__") {
    return String(newCategory ?? "").trim();
  }
  return String(selectedCategory ?? "").trim();
}

function buildImportPreview(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((hanzi) => ({
      hanzi,
      pinyin: generatePinyin(hanzi),
    }));
}

function removeLastOccurrence(items, value) {
  const next = [...items];
  const index = next.lastIndexOf(value);
  if (index >= 0) {
    next.splice(index, 1);
  }
  return next;
}

function App() {
  const initialCards = sanitizeCards(readStorage(STORAGE_KEYS.cards, starterCards));
  const initialCategories = sanitizeCategories(
    readStorage(STORAGE_KEYS.categories, starterCategories),
    initialCards,
  );
  const initialWrongBook = sanitizeWrongBook(
    readStorage(STORAGE_KEYS.wrongBook, {}),
    initialCards,
    initialCategories,
  );
  const initialProgressMap = sanitizeProgressMap(
    readStorage(STORAGE_KEYS.progress, null),
    initialCards,
    initialCategories,
  );
  const initialStudyOptions = sanitizeStudyOptions(
    readStorage(STORAGE_KEYS.studyOptions, BLANK_STUDY_OPTIONS),
  );
  const initialLastStudiedCategory = normalizeCategoryName(
    readStorage(STORAGE_KEYS.lastStudiedCategory, null),
  );

  const [view, setView] = useState("home");
  const [manageSection, setManageSection] = useState("menu");
  const [cards, setCards] = useState(initialCards);
  const [categories, setCategories] = useState(initialCategories);
  const [wrongBook, setWrongBook] = useState(initialWrongBook);
  const [progressMap, setProgressMap] = useState(initialProgressMap);
  const [studyCategory, setStudyCategory] = useState(
    Object.keys(initialProgressMap)[0] ?? null,
  );
  const [studyOptions, setStudyOptions] = useState(initialStudyOptions);
  const [lastStudiedCategory, setLastStudiedCategory] = useState(initialLastStudiedCategory);
  const [studyMessage, setStudyMessage] = useState("");
  const [manageMessage, setManageMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("全部");
  const [addForm, setAddForm] = useState(() => ({
    ...BLANK_ADD_FORM,
    category: initialCategories[0] ?? DEFAULT_CATEGORIES[0],
  }));
  const [importForm, setImportForm] = useState(() => ({
    ...BLANK_IMPORT_FORM,
    category: initialCategories[0] ?? DEFAULT_CATEGORIES[0],
  }));
  const [newCategoryForm, setNewCategoryForm] = useState(BLANK_CATEGORY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editingDraft, setEditingDraft] = useState(BLANK_EDIT_DRAFT);
  const [exportText, setExportText] = useState("");
  const [confirmDialog, setConfirmDialog] = useState(null);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.cards, cards);
  }, [cards]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.categories, categories);
  }, [categories]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.wrongBook, wrongBook);
  }, [wrongBook]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.studyOptions, studyOptions);
  }, [studyOptions]);

  useEffect(() => {
    if (!lastStudiedCategory) {
      window.localStorage.removeItem(STORAGE_KEYS.lastStudiedCategory);
      return;
    }

    writeStorage(STORAGE_KEYS.lastStudiedCategory, lastStudiedCategory);
  }, [lastStudiedCategory]);

  useEffect(() => {
    if (Object.keys(progressMap).length > 0) {
      writeStorage(STORAGE_KEYS.progress, progressMap);
      return;
    }

    window.localStorage.removeItem(STORAGE_KEYS.progress);
  }, [progressMap]);

  useEffect(() => {
    const nextCategories = sanitizeCategories(categories, cards);
    if (JSON.stringify(nextCategories) !== JSON.stringify(categories)) {
      setCategories(nextCategories);
      return;
    }

    const nextWrongBook = sanitizeWrongBook(wrongBook, cards, nextCategories);
    if (JSON.stringify(nextWrongBook) !== JSON.stringify(wrongBook)) {
      setWrongBook(nextWrongBook);
      return;
    }

    const nextProgressMap = sanitizeProgressMap(progressMap, cards, nextCategories);
    if (JSON.stringify(nextProgressMap) !== JSON.stringify(progressMap)) {
      setProgressMap(nextProgressMap);
    }

    if (lastStudiedCategory && !nextCategories.includes(lastStudiedCategory)) {
      setLastStudiedCategory(null);
    }
  }, [cards, categories, lastStudiedCategory, progressMap, wrongBook]);

  useEffect(() => {
    if (!categories.includes(addForm.category)) {
      setAddForm((current) => ({
        ...current,
        category: categories[0] ?? DEFAULT_CATEGORIES[0],
      }));
    }

    if (!categories.includes(importForm.category)) {
      setImportForm((current) => ({
        ...current,
        category: categories[0] ?? DEFAULT_CATEGORIES[0],
      }));
    }
  }, [categories, addForm.category, importForm.category]);

  const cardsById = useMemo(
    () => Object.fromEntries(cards.map((card) => [card.id, card])),
    [cards],
  );
  const cardOrderLookup = useMemo(
    () => Object.fromEntries(cards.map((card, index) => [card.id, index])),
    [cards],
  );

  const setSummaries = useMemo(
    () =>
      categories.map((category) => ({
        category,
        count: cards.filter((card) => card.set === category).length,
        wrongCount: (wrongBook[category] ?? []).length,
        progress: progressMap[category] ?? null,
      })),
    [cards, categories, wrongBook, progressMap],
  );

  const progress = studyCategory ? progressMap[studyCategory] ?? null : null;
  const currentCard = progress ? cardsById[progress.currentIds[progress.index]] : null;
  const roundDone =
    Boolean(progress) &&
    progress.index >= progress.currentIds.length &&
    progress.wrongIdsNextRound.length > 0;

  const filteredCards = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return cards
      .filter((card) => filterCategory === "全部" || card.set === filterCategory)
      .filter((card) => {
        if (!keyword) {
          return true;
        }

        return [card.set, card.hanzi, card.pinyin]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      });
  }, [cards, filterCategory, search]);

  const importPreview = useMemo(() => buildImportPreview(importForm.text), [importForm.text]);
  const addPreviewPinyin = useMemo(() => generatePinyin(addForm.hanzi), [addForm.hanzi]);

  function goHome() {
    setView("home");
    setStudyMessage("");
    setManageMessage("");
    setStudyCategory(null);
  }

  function openManage(section = "menu") {
    setView("manage");
    setManageSection(section);
    setManageMessage("");
  }

  function changeManageSection(section) {
    setManageSection(section);
    setManageMessage("");
  }

  function ensureCategoryExists(name) {
    const nextName = normalizeCategoryName(name);
    if (!nextName) {
      return null;
    }

    if (!categories.includes(nextName)) {
      setCategories([...categories, nextName]);
    }

    return nextName;
  }

  function buildStudyProgress(category, options) {
    let selectedCards = cards.filter((card) => card.set === category);

    if (options.onlyWrong) {
      const wrongIds = new Set(wrongBook[category] ?? []);
      selectedCards = selectedCards.filter((card) => wrongIds.has(card.id));
    }

    if (options.shuffle) {
      selectedCards = shuffleArray(selectedCards);
    }

    return {
      category,
      round: 1,
      currentIds: selectedCards.map((card) => card.id),
      wrongIdsNextRound: [],
      index: 0,
      revealed: false,
      shuffle: options.shuffle,
      onlyWrong: options.onlyWrong,
      history: [],
    };
  }

  function startStudy(category) {
    const nextProgress = buildStudyProgress(category, studyOptions);
    setStudyMessage("");
    setStudyCategory(category);
    setLastStudiedCategory(category);
    setProgressMap((current) =>
      nextProgress.currentIds.length > 0
        ? { ...current, [category]: nextProgress }
        : current,
    );
    setView("study");

    if (nextProgress.currentIds.length === 0) {
      setStudyMessage(studyOptions.onlyWrong ? "这一组现在没有不会的词。" : "这一组还没有词卡。");
      setStudyCategory(null);
    }
  }

  function continueStudy(category) {
    setStudyMessage("");
    setStudyCategory(category);
    setLastStudiedCategory(category);
    setView("study");
  }

  function restartStudyFromHome(category) {
    if (!category) {
      return;
    }

    const existingProgress = progressMap[category];
    if (!existingProgress) {
      return;
    }

    const nextProgress = buildStudyProgress(category, {
      shuffle: existingProgress.shuffle,
      onlyWrong: existingProgress.onlyWrong,
    });

    setProgressMap((current) => ({
      ...current,
      [category]: nextProgress,
    }));
    setStudyMessage("");
  }

  function toggleStudyOption(key) {
    setStudyOptions((current) => {
      const nextValue = !current[key];

      if (key === "shuffle") {
        setProgressMap((currentProgressMap) =>
          Object.fromEntries(
            Object.entries(currentProgressMap).map(([category, item]) => [
              category,
              reorderProgressItem(item, nextValue, cardOrderLookup),
            ]),
          ),
        );
      }

      return {
        ...current,
        [key]: nextValue,
      };
    });
  }

  function revealCard() {
    if (!progress || !currentCard) {
      return;
    }

    setProgressMap({
      ...progressMap,
      [progress.category]: {
        ...progress,
        revealed: !progress.revealed,
      },
    });
  }

  function markCard(knew) {
    if (!progress || !currentCard) {
      return;
    }

    const nextWrongSet = new Set(wrongBook[progress.category] ?? []);
    const prevWasWrong = nextWrongSet.has(currentCard.id);
    if (knew) {
      nextWrongSet.delete(currentCard.id);
    } else {
      nextWrongSet.add(currentCard.id);
    }

    setWrongBook({
      ...wrongBook,
      [progress.category]: [...nextWrongSet],
    });

    const nextWrongIds = knew
      ? progress.wrongIdsNextRound
      : [...progress.wrongIdsNextRound, currentCard.id];
    const nextIndex = progress.index + 1;
    const finishedRound = nextIndex >= progress.currentIds.length;

    if (finishedRound && nextWrongIds.length === 0) {
      const nextProgressMap = { ...progressMap };
      delete nextProgressMap[progress.category];
      setProgressMap(nextProgressMap);
      setStudyCategory(null);
      setStudyMessage(`完成了，第 ${progress.round} 轮全部答对。`);
      return;
    }

    setProgressMap({
      ...progressMap,
      [progress.category]: {
        ...progress,
        wrongIdsNextRound: nextWrongIds,
        index: nextIndex,
        revealed: false,
        history: [...(progress.history ?? []), { cardId: currentCard.id, knew, prevWasWrong }],
      },
    });
  }

  function continueNextRound() {
    if (!progress || progress.wrongIdsNextRound.length === 0) {
      return;
    }

    const nextIds = progress.shuffle
      ? shuffleArray(progress.wrongIdsNextRound)
      : [...progress.wrongIdsNextRound];

    setProgressMap({
      ...progressMap,
      [progress.category]: {
        ...progress,
        round: progress.round + 1,
        currentIds: nextIds,
        wrongIdsNextRound: [],
        index: 0,
        revealed: false,
        history: [],
      },
    });
  }

  function restartRound() {
    if (!progress) {
      return;
    }

    const restoredWrongSet = new Set(wrongBook[progress.category] ?? []);
    for (const entry of [...(progress.history ?? [])].reverse()) {
      if (entry.prevWasWrong) {
        restoredWrongSet.add(entry.cardId);
      } else {
        restoredWrongSet.delete(entry.cardId);
      }
    }

    setWrongBook({
      ...wrongBook,
      [progress.category]: [...restoredWrongSet],
    });

    const nextIds = progress.shuffle ? shuffleArray(progress.currentIds) : [...progress.currentIds];
    setProgressMap({
      ...progressMap,
      [progress.category]: {
        ...progress,
        currentIds: nextIds,
        wrongIdsNextRound: [],
        index: 0,
        revealed: false,
        history: [],
      },
    });
    setStudyMessage("");
  }

  function goToPreviousCard() {
    if (!progress || !(progress.history?.length > 0)) {
      return;
    }

    const lastEntry = progress.history[progress.history.length - 1];
    const restoredWrongSet = new Set(wrongBook[progress.category] ?? []);

    if (lastEntry.prevWasWrong) {
      restoredWrongSet.add(lastEntry.cardId);
    } else {
      restoredWrongSet.delete(lastEntry.cardId);
    }

    setWrongBook({
      ...wrongBook,
      [progress.category]: [...restoredWrongSet],
    });

    setProgressMap({
      ...progressMap,
      [progress.category]: {
        ...progress,
        index: Math.max(progress.index - 1, 0),
        revealed: false,
        wrongIdsNextRound: lastEntry.knew
          ? progress.wrongIdsNextRound
          : removeLastOccurrence(progress.wrongIdsNextRound, lastEntry.cardId),
        history: progress.history.slice(0, -1),
      },
    });
  }

  function addCategory(event) {
    event.preventDefault();
    const nextName = String(newCategoryForm.value ?? "").trim();
    if (!nextName) {
      setManageMessage("请输入新类别名称。");
      return;
    }

    if (categories.includes(nextName)) {
      setManageMessage("这个类别已经存在。");
      return;
    }

    setCategories([...categories, nextName]);
    setNewCategoryForm(BLANK_CATEGORY_FORM);
    setManageMessage(`已添加 ${nextName}。`);
  }

  function renameCategory(fromName, toNameRaw) {
    const toName = normalizeCategoryName(toNameRaw);
    if (!toName || fromName === toName || categories.includes(toName)) {
      return;
    }

    const nextCategories = categories.map((category) => (category === fromName ? toName : category));
    const nextCards = cards.map((card) => (card.set === fromName ? { ...card, set: toName } : card));
    const nextWrongBook = { ...wrongBook };
    nextWrongBook[toName] = nextWrongBook[fromName] ?? [];
    delete nextWrongBook[fromName];

    setCategories(nextCategories);
    setCards(nextCards);
    setWrongBook(sanitizeWrongBook(nextWrongBook, nextCards, nextCategories));

    const nextProgressMap = { ...progressMap };
    if (nextProgressMap[fromName]) {
      nextProgressMap[toName] = { ...nextProgressMap[fromName], category: toName };
      delete nextProgressMap[fromName];
    }
    setProgressMap(nextProgressMap);
    if (studyCategory === fromName) {
      setStudyCategory(toName);
    }

    setManageMessage(`已把 ${fromName} 改成 ${toName}。`);
  }

  function removeCategory(name) {
    const nextCards = cards.filter((card) => card.set !== name);
    const nextCategories = categories.filter((category) => category !== name);
    const nextWrongBook = { ...wrongBook };
    delete nextWrongBook[name];

    setCards(nextCards);
    setCategories(nextCategories);
    setWrongBook(sanitizeWrongBook(nextWrongBook, nextCards, nextCategories));

    const nextProgressMap = { ...progressMap };
    if (nextProgressMap[name]) {
      delete nextProgressMap[name];
      setProgressMap(nextProgressMap);
      if (studyCategory === name) {
        setStudyCategory(null);
        setStudyMessage("原来的类别已清除。");
      }
    }

    setManageMessage(`已清除 ${name}。`);
  }

  function submitAddCard(event) {
    event.preventDefault();
    const category = getCategoryChoice(addForm.category, newCategoryForm.value);
    const hanzi = addForm.hanzi.trim();
    const pinyin = addForm.pinyin.trim() || generatePinyin(hanzi);

    if (!category) {
      setManageMessage("请选择类别或添加类别。");
      return;
    }

    if (!hanzi) {
      setManageMessage("请输入汉字。");
      return;
    }

    ensureCategoryExists(category);
    setCards([
      {
        id: makeId(),
        set: category,
        hanzi,
        pinyin,
      },
      ...cards,
    ]);
    setAddForm({
      ...BLANK_ADD_FORM,
      category,
    });
    setNewCategoryForm(BLANK_CATEGORY_FORM);
    setManageMessage("已添加词卡。");
  }

  function startEditing(card) {
    setEditingId(card.id);
    setEditingDraft({
      set: card.set,
      pinyin: card.pinyin,
      hanzi: card.hanzi,
    });
  }

  function saveEdit() {
    if (!editingId || !editingDraft.hanzi.trim()) {
      return;
    }

    const previousCard = cards.find((card) => card.id === editingId);
    if (!previousCard) {
      return;
    }

    const nextCategory = ensureCategoryExists(editingDraft.set) ?? previousCard.set;
    const nextCards = cards.map((card) =>
      card.id === editingId
        ? {
            ...card,
            set: nextCategory,
            hanzi: editingDraft.hanzi.trim(),
            pinyin: editingDraft.pinyin.trim() || generatePinyin(editingDraft.hanzi),
          }
        : card,
    );
    setCards(nextCards);

    if (previousCard.set !== nextCategory) {
      const nextWrongBook = { ...wrongBook };
      const wasWrong = (nextWrongBook[previousCard.set] ?? []).includes(editingId);
      nextWrongBook[previousCard.set] = (nextWrongBook[previousCard.set] ?? []).filter(
        (cardId) => cardId !== editingId,
      );
      if (wasWrong) {
        nextWrongBook[nextCategory] = [...(nextWrongBook[nextCategory] ?? []), editingId];
      }
      setWrongBook(sanitizeWrongBook(nextWrongBook, nextCards, sanitizeCategories(categories, nextCards)));
    }

    setEditingId(null);
    setEditingDraft(BLANK_EDIT_DRAFT);
    setManageMessage("已保存修改。");
  }

  function deleteCard(cardId) {
    const nextCards = cards.filter((card) => card.id !== cardId);
    setCards(nextCards);

    const nextWrongBook = Object.fromEntries(
      categories.map((category) => [
        category,
        (wrongBook[category] ?? []).filter((id) => id !== cardId),
      ]),
    );
    setWrongBook(nextWrongBook);

    if (editingId === cardId) {
      setEditingId(null);
      setEditingDraft(BLANK_EDIT_DRAFT);
    }

    setManageMessage("已删除词卡。");
  }

  function requestDeleteCard(cardId) {
    const card = cards.find((item) => item.id === cardId);
    setConfirmDialog({
      type: "deleteCard",
      title: "清除词卡？",
      message: `将清除“${card?.hanzi || card?.pinyin || "这张词卡"}”。`,
      confirmLabel: "清除",
      payload: { cardId },
    });
  }

  function requestRemoveCategory(name) {
    const count = cards.filter((card) => card.set === name).length;
    setConfirmDialog({
      type: "removeCategory",
      title: "清除类别？",
      message:
        count > 0
          ? `将清除“${name}”和里面的 ${count} 张。`
          : `将清除“${name}”。`,
      confirmLabel: "清除",
      payload: { name },
    });
  }

  function confirmDialogAction() {
    if (!confirmDialog) {
      return;
    }

    if (confirmDialog.type === "deleteCard") {
      deleteCard(confirmDialog.payload.cardId);
    }

    if (confirmDialog.type === "removeCategory") {
      removeCategory(confirmDialog.payload.name);
    }

    if (confirmDialog.type === "clearProgress") {
      const category = confirmDialog.payload?.category;
      if (category) {
        const nextProgressMap = { ...progressMap };
        delete nextProgressMap[category];
        setProgressMap(nextProgressMap);
        if (studyCategory === category) {
          setStudyCategory(null);
        }
      } else {
        setProgressMap({});
        setStudyCategory(null);
      }
      setStudyMessage("");
    }

    setConfirmDialog(null);
  }

  function importCards(event) {
    event.preventDefault();
    const category = getCategoryChoice(importForm.category, newCategoryForm.value);
    if (!category) {
      setManageMessage("请选择类别或添加类别。");
      return;
    }

    const preview = buildImportPreview(importForm.text);
    if (preview.length === 0) {
      setManageMessage("请先输入汉字，每行一个。");
      return;
    }

    ensureCategoryExists(category);
    const newCards = preview.map((item) => ({
      id: makeId(),
      set: category,
      hanzi: item.hanzi,
      pinyin: item.pinyin,
    }));
    setCards([...newCards, ...cards]);
    setImportForm({
      ...BLANK_IMPORT_FORM,
      category,
    });
    setNewCategoryForm(BLANK_CATEGORY_FORM);
    setManageMessage(`已导入 ${newCards.length} 张。`);
  }

  function restoreBackup(text) {
    const value = String(text ?? "").trim();
    if (!value) {
      setManageMessage("没有可恢复的内容。");
      return;
    }

    try {
      const parsed = JSON.parse(value);
      const nextCards = sanitizeCards(
        Array.isArray(parsed) ? parsed : normalizeImportedCards(parsed.cards ?? [], DEFAULT_CATEGORIES[0]),
      );
      const nextCategories = sanitizeCategories(parsed.categories ?? starterCategories, nextCards);
      setCards(nextCards);
      setCategories(nextCategories);
      setWrongBook(sanitizeWrongBook(parsed.wrongBook ?? {}, nextCards, nextCategories));
      const nextProgressMap = sanitizeProgressMap(parsed.progress ?? null, nextCards, nextCategories);
      setProgressMap(nextProgressMap);
      setStudyCategory(Object.keys(nextProgressMap)[0] ?? null);
      setStudyOptions(sanitizeStudyOptions(parsed.studyOptions ?? BLANK_STUDY_OPTIONS));
      setManageMessage(`已恢复 ${nextCards.length} 张。`);
    } catch {
      setManageMessage("备份内容格式不正确。");
    }
  }

  function prepareExport() {
    const backup = exportBackup(cards, categories, wrongBook, progressMap, studyOptions);
    setExportText(backup);
    setManageMessage("已生成备份。");

    const blob = new Blob([backup], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "拼音卡-backup.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <div className="app-frame">
        <AppTopBar
          view={view}
          onHome={goHome}
          onOpenManage={() => openManage("menu")}
          onBack={
            view === "home"
              ? null
              : view === "study"
                ? goHome
                : manageSection === "menu"
                  ? goHome
                  : () => changeManageSection("menu")
          }
        />

        {view === "home" && (
          <HomeView
            categories={setSummaries}
            lastStudiedCategory={lastStudiedCategory}
            studyOptions={studyOptions}
            onToggleOption={toggleStudyOption}
            onStartStudy={startStudy}
            onContinueStudy={continueStudy}
            onRestartProgress={restartStudyFromHome}
          />
        )}

        {view === "study" && (
          <StudyView
            progress={progress}
            currentCard={currentCard}
            roundDone={roundDone}
            studyMessage={studyMessage}
            onGoHome={goHome}
            onReveal={revealCard}
            onMark={markCard}
            onContinueNextRound={continueNextRound}
            onRestartRound={restartRound}
            onGoToPreviousCard={goToPreviousCard}
            onDeleteCurrentCard={requestDeleteCard}
          />
        )}

        {view === "manage" && (
          <ManageView
            categories={categories}
            allCards={cards}
            filteredCards={filteredCards}
            search={search}
            filterCategory={filterCategory}
            manageSection={manageSection}
            manageMessage={manageMessage}
            addForm={addForm}
            addPreviewPinyin={addPreviewPinyin}
            importForm={importForm}
            importPreview={importPreview}
            newCategoryForm={newCategoryForm}
            editingId={editingId}
            editingDraft={editingDraft}
            exportText={exportText}
            onBack={goHome}
            onOpenSection={changeManageSection}
            onRestoreBackup={restoreBackup}
            onChangeSearch={setSearch}
            onChangeFilterCategory={setFilterCategory}
            onChangeAddForm={setAddForm}
            onChangeImportForm={setImportForm}
            onChangeNewCategoryForm={setNewCategoryForm}
            onAddCategory={addCategory}
            onRenameCategory={renameCategory}
            onRemoveCategory={requestRemoveCategory}
            onSubmitAddCard={submitAddCard}
            onStartEditing={startEditing}
            onChangeEditingDraft={setEditingDraft}
            onSaveEdit={saveEdit}
            onCancelEdit={() => {
              setEditingId(null);
              setEditingDraft(BLANK_EDIT_DRAFT);
            }}
            onDeleteCard={requestDeleteCard}
            onImportCards={importCards}
            onPrepareExport={prepareExport}
            onChangeExportText={setExportText}
          />
        )}
        <ConfirmDialog
          dialog={confirmDialog}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={confirmDialogAction}
        />
      </div>
      <footer className="site-footer">Kyoii 制作</footer>
    </div>
  );
}

function AppTopBar({ view, onHome, onOpenManage, onBack }) {
  return (
    <div className="app-topbar">
      <div className="brand-block">
        <div className="brand-line">
          <button className="brand-button" type="button" onClick={onHome}>
            拼音卡
          </button>
          <span className="brand-dot" aria-hidden="true">
            ·
          </span>
          <p className="brand-tagline">看拼音，练汉字</p>
        </div>
        {onBack ? <BackArrowButton onClick={onBack} /> : null}
      </div>
      {view === "home" ? (
        <button className="text-button" type="button" onClick={onOpenManage}>
          管理词卡
        </button>
      ) : (
        <div className="topbar-spacer" />
      )}
    </div>
  );
}

function HomeView({
  categories,
  lastStudiedCategory,
  studyOptions,
  onToggleOption,
  onStartStudy,
  onContinueStudy,
  onRestartProgress,
}) {
  return (
    <main className="page page-home">
      <header className="page-header page-header-home">
        <div className="page-intro">
          <h1>今天学哪一组？</h1>
        </div>
      </header>

      <div className="study-toggles">
        <button
          className={`toggle-chip ${studyOptions.shuffle ? "is-active" : ""}`}
          type="button"
          onClick={() => onToggleOption("shuffle")}
        >
          随机顺序
        </button>
        <button
          className={`toggle-chip ${studyOptions.onlyWrong ? "is-active" : ""}`}
          type="button"
          onClick={() => onToggleOption("onlyWrong")}
        >
          只学不会
        </button>
      </div>

      <section className="set-grid" aria-label="类别列表">
        {categories.map(({ category, count, wrongCount, progress }) => {
          const isInProgress = Boolean(progress);
          const isLatestStudied = isInProgress && lastStudiedCategory === category;
          const homeProgressValue =
            isInProgress && progress.currentIds.length > 0
              ? Math.min((progress.index / progress.currentIds.length) * 100, 100)
              : 0;

          return (
            <div key={category} className={`set-card ${isInProgress ? "is-active" : ""}`}>
              <div className="set-card-head">
                <button
                  className={`set-card-main ${isInProgress ? "is-progressing" : ""}`}
                  type="button"
                  onClick={() => (isInProgress ? onContinueStudy(category) : onStartStudy(category))}
                >
                  <div>
                    {isLatestStudied && <p className="set-kicker">最近学习</p>}
                    <h2 className={isInProgress ? "continue-category" : ""}>{category}</h2>
                    <p className={isInProgress ? "set-meta set-meta-active" : "set-meta"}>
                      {isInProgress ? "继续" : `${count} 张`}
                    </p>
                  </div>
                  {!isInProgress && wrongCount > 0 && <span className="set-badge">不会 {wrongCount}</span>}
                  {isInProgress && (
                    <span className="continue-indicator" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="m9.3 5.3 1.4-1.4L17.8 11l-7.1 7.1-1.4-1.4 5.7-5.7-5.7-5.7Z" />
                      </svg>
                    </span>
                  )}
                </button>
                {isInProgress && (
                  <div className="set-card-actions">
                    <button
                      className="action-icon-button"
                      type="button"
                      aria-label={`${category} 重来`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRestartProgress(category);
                      }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 5a7 7 0 1 1-6.7 9h2.1A5 5 0 1 0 8 8.9L10.2 11H4V4.8L6.6 7.4A6.95 6.95 0 0 1 12 5Z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
              {isInProgress && (
                <div className="set-card-progress">
                  <div className="active-card-header">
                    <span className="round-chip">第 {progress.round} 轮</span>
                    <p className="set-card-progress-copy">
                      {Math.min(progress.index + 1, progress.currentIds.length)} / {progress.currentIds.length}
                    </p>
                  </div>
                  <div className="compact-progress-wrap">
                    <div className="compact-progress-bar" aria-hidden="true">
                      <span style={{ width: `${homeProgressValue}%` }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}

function StudyView({
  progress,
  currentCard,
  roundDone,
  studyMessage,
  onGoHome,
  onReveal,
  onMark,
  onContinueNextRound,
  onRestartRound,
  onGoToPreviousCard,
  onDeleteCurrentCard,
}) {
  const [showRoundActions, setShowRoundActions] = useState(false);
  const [showShortcutBar, setShowShortcutBar] = useState(false);
  const [showShortcutHint, setShowShortcutHint] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const hasShownShortcutHintRef = useRef(false);
  const progressValue =
    progress && progress.currentIds.length > 0
      ? Math.min((progress.index / progress.currentIds.length) * 100, 100)
      : 0;

  useEffect(() => {
    setShowRoundActions(false);
  }, [progress?.category, progress?.round, progress?.index]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 721px)");
    function syncMode() {
      setIsDesktop(mediaQuery.matches);
    }

    syncMode();
    mediaQuery.addEventListener("change", syncMode);
    return () => mediaQuery.removeEventListener("change", syncMode);
  }, []);

  useEffect(() => {
    if (!isDesktop || showShortcutBar || !progress || !currentCard || hasShownShortcutHintRef.current) {
      setShowShortcutHint(false);
      return undefined;
    }

    hasShownShortcutHintRef.current = true;
    setShowShortcutHint(true);
    const timeoutId = window.setTimeout(() => {
      setShowShortcutHint(false);
    }, 3300);

    return () => window.clearTimeout(timeoutId);
  }, [currentCard, isDesktop, progress, showShortcutBar]);

  useEffect(() => {
    if (!isDesktop) {
      return undefined;
    }

    function handleKeyDown(event) {
      const tagName = event.target?.tagName;
      const isTypingTarget =
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT" ||
        event.target?.isContentEditable;

      if (isTypingTarget || document.querySelector('[role="dialog"]')) {
        return;
      }

      const lowerKey = event.key.toLowerCase();

      if (lowerKey === "h") {
        event.preventDefault();
        setShowShortcutBar((current) => !current);
        return;
      }

      if (lowerKey === "q") {
        event.preventDefault();
        onGoHome();
        return;
      }

      if (roundDone) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onContinueNextRound();
        }
        return;
      }

      if (!progress || !currentCard) {
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        onReveal();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        onMark(true);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        onMark(false);
        return;
      }

      if (event.key === "ArrowLeft") {
        if (progress.history?.length > 0) {
          event.preventDefault();
          onGoToPreviousCard();
        }
        return;
      }

      if (event.key === "Delete" || lowerKey === "d") {
        event.preventDefault();
        onDeleteCurrentCard(currentCard.id);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    currentCard,
    onContinueNextRound,
    onDeleteCurrentCard,
    onGoHome,
    onGoToPreviousCard,
    onMark,
    onReveal,
    progress,
    roundDone,
    isDesktop,
  ]);

  return (
    <main className="page page-study">
      <header className="study-header">
        {progress ? (
          <div className="study-title">
            <h1>{progress.category}</h1>
            <button
              className="round-trigger"
              type="button"
              onClick={() => setShowRoundActions((current) => !current)}
            >
              第 {progress.round} 轮 ·{" "}
              {Math.min(progress.index + 1, progress.currentIds.length)} / {progress.currentIds.length}
            </button>
          </div>
        ) : (
          <div className="study-title">
            <h1>学习</h1>
          </div>
        )}
      </header>

      {progress && (
        <>
          <div className="round-progress-bar" aria-hidden="true">
            <span style={{ width: `${progressValue}%` }} />
          </div>
          {showRoundActions && (
            <div className="study-round-actions">
              <button className="action-icon-button" type="button" aria-label="重来" onClick={onRestartRound}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5a7 7 0 1 1-6.7 9h2.1A5 5 0 1 0 8 8.9L10.2 11H4V4.8L6.6 7.4A6.95 6.95 0 0 1 12 5Z" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}

      {progress && currentCard && (
        <>
          <div className="card-panel-shell">
            {progress.history?.length > 0 && (
              <button
                className="action-icon-button study-prev-button"
                type="button"
                aria-label="上一张"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onGoToPreviousCard}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M14.7 6.3 9 12l5.7 5.7-1.4 1.4L6.2 12l7.1-7.1 1.4 1.4Z" />
                </svg>
              </button>
            )}
            <button
              className={`delete-icon-button study-delete-button ${progress.revealed ? "is-visible" : ""}`}
              type="button"
              aria-label="清除当前词卡"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onDeleteCurrentCard(currentCard.id)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v7h-2v-7Zm4 0h2v7h-2v-7ZM7 10h2v7H7v-7Zm1 10h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2Z" />
              </svg>
            </button>
            <button
              className={`card-panel ${progress.revealed ? "is-revealed" : ""}`}
              type="button"
              onClick={onReveal}
            >
              <div className="card-pinyin">{currentCard.pinyin}</div>
              <div className="card-hanzi">{progress.revealed ? currentCard.hanzi || "（未填写）" : "···"}</div>
            </button>
          </div>

          <div className="answer-row">
            <button className="answer-button is-light" type="button" aria-label="不会" onClick={() => onMark(false)}>
              <span aria-hidden="true">✕</span>
            </button>
            <button className="answer-button" type="button" aria-label="会" onClick={() => onMark(true)}>
              <span aria-hidden="true">✓</span>
            </button>
          </div>
          {isDesktop && !showShortcutBar && (
            <button
              className={`shortcut-hint ${showShortcutHint ? "is-visible" : ""}`}
              type="button"
              onClick={() => setShowShortcutBar(true)}
            >
              按 H 查看操作
            </button>
          )}
          {isDesktop && showShortcutBar && (
            <div className="shortcut-bar" aria-label="快捷键">
              <span><kbd>↑</kbd> 显示</span>
              <span><kbd>→</kbd> 会</span>
              <span><kbd>↓</kbd> 不会</span>
              <span><kbd>←</kbd> 上一张</span>
              <span><kbd>D</kbd> 删除</span>
              <span><kbd>Q</kbd> 退出</span>
              <span><kbd>H</kbd> 隐藏</span>
            </div>
          )}
        </>
      )}

      {progress && roundDone && (
        <section className="status-panel">
          <h2>下一轮</h2>
          <p>还剩 {progress.wrongIdsNextRound.length} 张。</p>
          <div className="inline-actions inline-actions-centered">
            <button className="action-icon-button" type="button" aria-label="重来" onClick={onRestartRound}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5a7 7 0 1 1-6.7 9h2.1A5 5 0 1 0 8 8.9L10.2 11H4V4.8L6.6 7.4A6.95 6.95 0 0 1 12 5Z" />
              </svg>
            </button>
            <button className="primary-button primary-button-icon" type="button" onClick={onContinueNextRound}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9.3 5.3 1.4-1.4L17.8 11l-7.1 7.1-1.4-1.4 5.7-5.7-5.7-5.7Z" />
              </svg>
              <span>下一轮</span>
            </button>
          </div>
        </section>
      )}

      {!progress && (
        <section className="status-panel">
          <h2>{studyMessage || "现在没有进行中的学习。"}</h2>
          <button className="secondary-button" type="button" onClick={onGoHome}>
            返回
          </button>
        </section>
      )}
    </main>
  );
}

function ManageView({
  categories,
  allCards,
  filteredCards,
  search,
  filterCategory,
  manageSection,
  manageMessage,
  addForm,
  addPreviewPinyin,
  importForm,
  importPreview,
  newCategoryForm,
  editingId,
  editingDraft,
  exportText,
  onBack,
  onOpenSection,
  onRestoreBackup,
  onChangeSearch,
  onChangeFilterCategory,
  onChangeAddForm,
  onChangeImportForm,
  onChangeNewCategoryForm,
  onAddCategory,
  onRenameCategory,
  onRemoveCategory,
  onSubmitAddCard,
  onStartEditing,
  onChangeEditingDraft,
  onSaveEdit,
  onCancelEdit,
  onDeleteCard,
  onImportCards,
  onPrepareExport,
  onChangeExportText,
}) {
  const activeSection = MANAGE_SECTIONS.find((section) => section.id === manageSection);
  const returnTarget = manageSection === "menu" ? onBack : () => onOpenSection("menu");

  return (
    <main className="page page-manage">
      <header className="page-header">
        <div className="page-intro">
          <h1>{activeSection?.label || "管理词卡"}</h1>
        </div>
      </header>

      {manageMessage && <p className="section-note manage-message">{manageMessage}</p>}

      {manageSection === "menu" && (
        <section className="menu-grid">
          {MANAGE_SECTIONS.filter((section) => section.id !== "menu").map((section) => (
            <button
              key={section.id}
              className={`set-card manage-menu-button ${section.id === "add" ? "is-primary" : ""}`}
              type="button"
              onClick={() => onOpenSection(section.id)}
            >
              <span className="menu-card-icon" aria-hidden="true">
                <SectionIcon name={section.icon} />
              </span>
              <div className="manage-menu-copy">
                <h2>{section.shortLabel}</h2>
              </div>
            </button>
          ))}
        </section>
      )}

      {manageSection === "categories" && (
        <section className="manage-card">
          <h2>新建类别</h2>
          <form className="form-grid" onSubmit={onAddCategory}>
            <label>
              类别名称
              <input
                value={newCategoryForm.value}
                onChange={(event) => onChangeNewCategoryForm({ value: event.target.value })}
                placeholder="第五周"
              />
            </label>
            <button className="primary-button" type="submit">
              添加类别
            </button>
          </form>

          <div className="list-stack">
            {categories.map((category) => (
              <CategoryRow
                key={category}
                category={category}
                cardCount={allCards.filter((card) => card.set === category).length}
                onRename={onRenameCategory}
                onRemove={onRemoveCategory}
              />
            ))}
          </div>
        </section>
      )}

      {manageSection === "add" && (
        <section className="manage-card">
          <h2>添加</h2>
          <form className="form-grid form-stack" onSubmit={onSubmitAddCard}>
            <CategoryChooser
              categories={categories}
              value={addForm.category}
              onValueChange={(value) => onChangeAddForm({ ...addForm, category: value })}
              newValue={newCategoryForm.value}
              onNewValueChange={(value) => onChangeNewCategoryForm({ value })}
            />
            <label>
              汉字
              <textarea
                rows={4}
                value={addForm.hanzi}
                onChange={(event) =>
                  onChangeAddForm({
                    ...addForm,
                    hanzi: event.target.value,
                    pinyin: generatePinyin(event.target.value),
                  })
                }
                placeholder="汉字"
              />
            </label>
            <label>
              拼音
              <input
                value={addForm.pinyin || addPreviewPinyin}
                onChange={(event) => onChangeAddForm({ ...addForm, pinyin: event.target.value })}
                placeholder="自动"
              />
            </label>
            <button className="primary-button" type="submit">
              添加词卡
            </button>
          </form>
        </section>
      )}

      {manageSection === "edit" && (
        <section className="manage-card">
          <div className="manage-toolbar">
            <h2>编辑</h2>
            <span>{allCards.length} 张</span>
          </div>
          <div className="filter-row">
            <input
              value={search}
              onChange={(event) => onChangeSearch(event.target.value)}
              placeholder="搜索"
            />
            <select
              value={filterCategory}
              onChange={(event) => onChangeFilterCategory(event.target.value)}
            >
              <option value="全部">全部类别</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div className="list-stack">
            {filteredCards.map((card) =>
              editingId === card.id ? (
                <article className="word-row is-editing" key={card.id}>
                  <label>
                    类别
                    <select
                      value={editingDraft.set}
                      onChange={(event) =>
                        onChangeEditingDraft({ ...editingDraft, set: event.target.value })
                      }
                    >
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    汉字
                    <input
                      value={editingDraft.hanzi}
                      onChange={(event) =>
                        onChangeEditingDraft({
                          ...editingDraft,
                          hanzi: event.target.value,
                          pinyin:
                            editingDraft.pinyin && editingDraft.pinyin !== generatePinyin(editingDraft.hanzi)
                              ? editingDraft.pinyin
                              : generatePinyin(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    拼音
                    <input
                      value={editingDraft.pinyin}
                      onChange={(event) =>
                        onChangeEditingDraft({ ...editingDraft, pinyin: event.target.value })
                      }
                    />
                  </label>
                  <div className="inline-actions">
                    <button className="primary-button" type="button" onClick={onSaveEdit}>
                      保存
                    </button>
                    <button className="secondary-button" type="button" onClick={onCancelEdit}>
                      取消
                    </button>
                  </div>
                </article>
              ) : (
                <article className="word-row" key={card.id}>
                  <div className="word-copy">
                    <span className="word-set">{card.set}</span>
                    <h3>{card.hanzi || "（未填写）"}</h3>
                    <p>{card.pinyin || "（未填写）"}</p>
                  </div>
                  <div className="inline-actions">
                    <button className="secondary-button" type="button" onClick={() => onStartEditing(card)}>
                      编辑
                    </button>
                    <button
                      className="delete-icon-button"
                      type="button"
                      aria-label="清除词卡"
                      onClick={() => onDeleteCard(card.id)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v7h-2v-7Zm4 0h2v7h-2v-7ZM7 10h2v7H7v-7Zm1 10h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2Z" />
                      </svg>
                    </button>
                  </div>
                </article>
              ),
            )}
            {filteredCards.length === 0 && <p className="empty-hint">没有找到词卡。</p>}
          </div>
        </section>
      )}

      {manageSection === "import" && (
        <section className="manage-card">
          <h2>导入</h2>
          <form className="form-grid form-stack" onSubmit={onImportCards}>
            <CategoryChooser
              categories={categories}
              value={importForm.category}
              onValueChange={(value) => onChangeImportForm({ ...importForm, category: value })}
              newValue={newCategoryForm.value}
              onNewValueChange={(value) => onChangeNewCategoryForm({ value })}
            />
            <label>
              汉字列表（每行一条）
              <textarea
                rows={10}
                value={importForm.text}
                onChange={(event) =>
                  onChangeImportForm({
                    ...importForm,
                    text: event.target.value,
                  })
                }
                placeholder={"每行一个"}
              />
            </label>
            {importPreview.length > 0 && (
              <div className="preview-panel">
                <div className="list-stack compact-stack">
                  {importPreview.map((item, index) => (
                    <div className="preview-row" key={`${item.hanzi}-${index}`}>
                      <strong>{item.hanzi}</strong>
                      <span>{item.pinyin}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button className="primary-button" type="submit">
              导入词卡
            </button>
          </form>
        </section>
      )}

      {manageSection === "export" && (
        <section className="manage-card">
          <h2>导出</h2>
          <div className="inline-actions">
            <button className="primary-button" type="button" onClick={onPrepareExport}>
              下载备份
            </button>
          </div>
          <label>
            备份内容
            <textarea
              rows={12}
              value={exportText}
              onChange={(event) => onChangeExportText(event.target.value)}
              placeholder="粘贴备份"
            />
          </label>
          <div className="inline-actions">
            <button className="secondary-button" type="button" onClick={() => onRestoreBackup(exportText)}>
              用这里的内容恢复
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

function CategoryChooser({
  categories,
  value,
  newValue,
  onValueChange,
  onNewValueChange,
}) {
  return (
    <div className="category-chooser">
      <label>
        选择类别
        <select value={value} onChange={(event) => onValueChange(event.target.value)}>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
          <option value="__new__">添加类别</option>
        </select>
      </label>
      {value === "__new__" && (
        <label>
          新类别名称
          <input
            value={newValue}
            onChange={(event) => onNewValueChange(event.target.value)}
            placeholder="第五周"
          />
        </label>
      )}
    </div>
  );
}

function SectionIcon({ name }) {
  if (name === "tag") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M4 6a2 2 0 0 1 2-2h6.6a2 2 0 0 1 1.4.6l5.4 5.4a2 2 0 0 1 0 2.8l-6.6 6.6a2 2 0 0 1-2.8 0L4.6 14A2 2 0 0 1 4 12.6V6Zm4 2.5A1.5 1.5 0 1 0 8 5.5a1.5 1.5 0 0 0 0 3Z" />
      </svg>
    );
  }

  if (name === "plus") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
      </svg>
    );
  }

  if (name === "edit") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="m16.9 3.5 3.6 3.6-11 11L6 18l-.1-3.5 11-11ZM5 20h14v-2H5v2Z" />
      </svg>
    );
  }

  if (name === "import") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M11 4h2v8.2l2.6-2.6 1.4 1.4-5 5-5-5 1.4-1.4 2.6 2.6V4ZM5 18h14v2H5v-2Z" />
      </svg>
    );
  }

  if (name === "export") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M11 20h2v-8.2l2.6 2.6 1.4-1.4-5-5-5 5 1.4 1.4 2.6-2.6V20ZM5 4h14v2H5V4Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" />
    </svg>
  );
}

function CategoryRow({ category, cardCount, onRename, onRemove }) {
  const [draft, setDraft] = useState(category);

  useEffect(() => {
    setDraft(category);
  }, [category]);

  return (
    <article className="word-row">
      <div className="word-copy">
        <h3>{category}</h3>
        <p>{cardCount} 张</p>
      </div>
      <div className="inline-actions category-actions">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button className="secondary-button" type="button" onClick={() => onRename(category, draft)}>
          改名
        </button>
        <button
          className="delete-icon-button"
          type="button"
          aria-label="清除类别"
          onClick={() => onRemove(category)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v7h-2v-7Zm4 0h2v7h-2v-7ZM7 10h2v7H7v-7Zm1 10h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2Z" />
          </svg>
        </button>
      </div>
    </article>
  );
}

function ConfirmDialog({ dialog, onCancel, onConfirm }) {
  if (!dialog) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h2 id="confirm-title">{dialog.title}</h2>
        <p>{dialog.message}</p>
        <div className="inline-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="danger-button" type="button" onClick={onConfirm}>
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;

function BackArrowButton({ onClick }) {
  return (
    <button className="back-arrow-button" type="button" onClick={onClick} aria-label="返回">
      ←
    </button>
  );
}
