// === MODEL ===
let shoppingList = [];
let currentLang = "pl";

const defaultCategoryOrder = [
  "dairy", "bread", "fruits", "vegetables", "meat", "fish",
  "dry", "frozen", "beverages", "snacks", "other"
];

let categoryOrder = defaultCategoryOrder;
const undoStack = [];
const MAX_UNDO_STEPS = 30;
let isUndoInProgress = false;
let currentUserId = "";
let householdId = "";
let appReady = false;
let shoppingUnsubscribe = null;

// === FIREBASE ===
const db = window.db;
const { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, setDoc, getDoc, serverTimestamp } = window.firestore;
const { auth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } = window.firebaseAuth;

function getShoppingListCollectionRef() {
  if (!householdId) throw new Error("Brak aktywnego household. Zaloguj się ponownie.");
  return collection(db, "households", householdId, "shoppingList");
}

function getShoppingItemDocRef(itemId) {
  if (!householdId) throw new Error("Brak aktywnego household. Zaloguj się ponownie.");
  return doc(db, "households", householdId, "shoppingList", itemId);
}

async function ensureUserAndHousehold() {
  currentUserId = auth.currentUser ? auth.currentUser.uid : "";
  if (!currentUserId) throw new Error("Brak zalogowanego użytkownika.");
  await auth.currentUser.getIdToken(true);
  const userRef = doc(db, "users", currentUserId);
  const userSnapshot = await getDoc(userRef);
  const bootstrapOwnHousehold = async () => {
    householdId = `household-${currentUserId}`;
    const ownHouseholdRef = doc(db, "households", householdId);
    await setDoc(ownHouseholdRef, { name: "Dom", members: [currentUserId] }, { merge: true });
    await setDoc(userRef, { householdId }, { merge: true });
  };

  if (!userSnapshot.exists() || !userSnapshot.data().householdId) {
    await bootstrapOwnHousehold();
  } else {
    householdId = userSnapshot.data().householdId;
    try {
      const householdRef = doc(db, "households", householdId);
      const householdSnapshot = await getDoc(householdRef);
      const householdData = householdSnapshot.exists() ? householdSnapshot.data() : {};
      const existingMembers = Array.isArray(householdData.members) ? householdData.members : [];
      if (!existingMembers.includes(currentUserId)) {
        const householdName = typeof householdData.name === "string" && householdData.name
          ? householdData.name
          : "Dom";
        await setDoc(householdRef, { name: householdName, members: [...existingMembers, currentUserId] }, { merge: true });
      }
    } catch (error) {
      const code = error && error.code ? error.code : "";
      // Recover from stale/invalid household assignment by bootstrapping a personal household.
      if (code === "permission-denied" || code === "not-found") {
        await bootstrapOwnHousehold();
      } else {
        throw error;
      }
    }
  }

  const userData = userSnapshot.exists() ? userSnapshot.data() : {};
  if (Array.isArray(userData.categoryOrder) && userData.categoryOrder.length > 0) {
    categoryOrder = userData.categoryOrder;
  }
  try { localStorage.setItem("categoryOrderCache", JSON.stringify(categoryOrder)); } catch (_) {}

  localStorage.setItem("shoppingHouseholdId", householdId);
  updateHouseholdMetaUI();
}

function updateHouseholdMetaUI() {
  const uidLabel = document.getElementById("currentUidLabel");
  const householdLabel = document.getElementById("currentHouseholdLabel");
  if (uidLabel) uidLabel.textContent = currentUserId || "-";
  if (householdLabel) householdLabel.textContent = householdId || "-";
}

function setHouseholdMessage(message, isError = false) {
  const messageEl = document.getElementById("householdActionMessage");
  if (!messageEl) return;
  messageEl.textContent = message;
  messageEl.style.color = isError ? "#c62828" : "";
}

async function addMemberToHousehold(memberUid) {
  if (!appReady || !currentUserId || !householdId) {
    throw new Error("Najpierw zaloguj się do aplikacji.");
  }
  const normalizedUid = (memberUid || "").trim();
  if (!normalizedUid) return false;

  const householdRef = doc(db, "households", householdId);
  const householdSnapshot = await getDoc(householdRef);
  if (!householdSnapshot.exists()) {
    throw new Error("Nie znaleziono household.");
  }

  const data = householdSnapshot.data();
  const name = data.name || "Dom";
  const members = Array.isArray(data.members) ? data.members : [];
  if (members.includes(normalizedUid)) return null;

  await setDoc(householdRef, { name, members: [...members, normalizedUid] }, { merge: true });

  const memberUserRef = doc(db, "users", normalizedUid);
  await setDoc(memberUserRef, { householdId }, { merge: true });

  return true;
}

function pushUndoAction(action) {
  if (isUndoInProgress) return;
  undoStack.push(action);
  if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
  updateUndoUI();
}

function updateUndoUI() {
  const undoBtn = document.getElementById("undoButton");
  if (!undoBtn) return;
  undoBtn.disabled = undoStack.length === 0;
  undoBtn.classList.toggle("disabled", undoStack.length === 0);
}

function isEditableElement(element) {
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
}

async function undoLastChange() {
  if (!appReady) return;
  const action = undoStack.pop();
  updateUndoUI();
  if (!action) return;

  isUndoInProgress = true;
  try {
    if (action.type === "add") {
      await deleteDoc(getShoppingItemDocRef(action.id));
    } else if (action.type === "delete") {
      const { id, createdAt, updatedAt, ...rest } = action.item;
      await setDoc(getShoppingItemDocRef(action.item.id), {
        ...rest,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else if (action.type === "toggle") {
      await updateDoc(getShoppingItemDocRef(action.id), {
        toBuy: action.previousToBuy,
        quantity: action.previousQuantity,
        updatedAt: serverTimestamp()
      });
    } else if (action.type === "updateQuantity") {
      await updateDoc(getShoppingItemDocRef(action.id), {
        quantity: action.previousQuantity,
        updatedAt: serverTimestamp()
      });
    } else if (action.type === "updateUnit") {
      await updateDoc(getShoppingItemDocRef(action.id), {
        unit: action.previousUnit,
        updatedAt: serverTimestamp()
      });
    }
  } finally {
    isUndoInProgress = false;
  }
}

async function saveCategoryOrder() {
  if (!appReady || !currentUserId) return;
  try {
    localStorage.setItem("categoryOrderCache", JSON.stringify(categoryOrder));
    const userRef = doc(db, "users", currentUserId);
    await updateDoc(userRef, { categoryOrder });
  } catch (_) {}
}

// === DATABASE FUNCTIONS ===
async function loadData() {
  const q = getShoppingListCollectionRef();
  if (shoppingUnsubscribe) shoppingUnsubscribe();
  shoppingUnsubscribe = onSnapshot(q, snapshot => {
    shoppingList = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));
    try {
      localStorage.setItem("shoppingListCache", JSON.stringify(shoppingList));
    } catch (_) {}
    renderLists();
  });
}

async function addProductToDB(name, category, quantity = 1, unit = "szt") {
  if (!appReady) return;
  const newItem = {
    name,
    category,
    quantity,
    unit,
    toBuy: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const docRef = await addDoc(getShoppingListCollectionRef(), newItem);
  pushUndoAction({ type: "add", id: docRef.id });
}

async function toggleToBuy(id) {
  const item = shoppingList.find(i => i.id === id);
  if (!item || !appReady) return;
  const previousToBuy = item.toBuy;
  const previousQuantity = item.quantity || 1;
  item.toBuy = !item.toBuy;
  
  // When adding to shopping list, set default quantity
  if (item.toBuy && !item.quantity) {
    item.quantity = 1;
  }
  
  const updateData = {
    toBuy: item.toBuy,
    quantity: item.quantity || 1,
    updatedAt: serverTimestamp()
  };
  if (!item.toBuy) {
    updateData.starred = false;
    item.starred = false;
  }
  await updateDoc(getShoppingItemDocRef(id), updateData);
  pushUndoAction({ type: "toggle", id, previousToBuy, previousQuantity });
  renderLists();
}

async function updateQuantity(id, newQuantity) {
  if (!appReady || newQuantity <= 0) return;
  const item = shoppingList.find(i => i.id === id);
  if (!item) return;
  const previousQuantity = item.quantity || 1;
  if (previousQuantity === newQuantity) return;
  item.quantity = newQuantity;
  await updateDoc(getShoppingItemDocRef(id), {
    quantity: newQuantity,
    updatedAt: serverTimestamp()
  });
  pushUndoAction({ type: "updateQuantity", id, previousQuantity });
}

async function updateUnit(id, newUnit) {
  if (!appReady) return;
  const item = shoppingList.find(i => i.id === id);
  if (!item) return;
  const previousUnit = item.unit || "szt";
  if (previousUnit === newUnit) return;
  item.unit = newUnit;
  await updateDoc(getShoppingItemDocRef(id), {
    unit: newUnit,
    updatedAt: serverTimestamp()
  });
  pushUndoAction({ type: "updateUnit", id, previousUnit });
}

async function toggleStar(id) {
  if (!appReady) return;
  const item = shoppingList.find(i => i.id === id);
  if (!item) return;
  item.starred = !item.starred;
  await updateDoc(getShoppingItemDocRef(id), {
    starred: item.starred,
    updatedAt: serverTimestamp()
  });
  renderLists();
}

async function deleteProduct(id) {
  if (!appReady) return;
  const item = shoppingList.find(i => i.id === id);
  if (!item) return;
  await deleteDoc(getShoppingItemDocRef(id));
  pushUndoAction({ type: "delete", item: { ...item } });
  shoppingList = shoppingList.filter(i => i.id !== id);
  renderLists();
}

// === VIEW ===
function createProductElement(item) {
  const li = document.createElement("li");
  li.classList.add("product-item");
  li.dataset.id = item.id;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = item.toBuy;
  checkbox.addEventListener("change", () => toggleToBuy(item.id));

  const label = document.createElement("span");
  label.className = "product-label";
  label.textContent = item.name;

  const deleteBtn = document.createElement("span");
  deleteBtn.textContent = "×";
  deleteBtn.className = "delete-btn";
  deleteBtn.addEventListener("click", () => deleteProduct(item.id));

  li.addEventListener("click", e => {
    if (e.target === checkbox || e.target === deleteBtn) return;
    deleteBtn.classList.remove("visible");
    void deleteBtn.offsetWidth;
    deleteBtn.classList.add("visible");
    deleteBtn.addEventListener("animationend", () => deleteBtn.classList.remove("visible"), { once: true });
  });

  li.appendChild(checkbox);
  li.appendChild(label);
  li.appendChild(deleteBtn);

  return li;
}

function normalize(str) {
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
}

function matchesSearch(name, search) {
  if (!search) return true;
  return normalize(name).includes(search);
}

function renderLists() {
  const toBuyList = document.getElementById("toBuyList");
  const productContainer = document.getElementById("productContainer");
  const search = normalize(document.getElementById("searchInput").value);

  toBuyList.innerHTML = "";
  productContainer.innerHTML = "";

  const categories = {};

  shoppingList.forEach(item => {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  });

  categoryOrder.forEach(category => {
    if (!categories[category]) return;

    const matchingItems = categories[category]
      .filter(item => matchesSearch(item.name, search))
      .sort((a, b) => a.name.localeCompare(b.name, currentLang));
    if (matchingItems.length === 0) return;

    const catBlock = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = translations[currentLang].categories[category] || category;
    catBlock.appendChild(title);

    matchingItems.forEach(item => {
      const li = createProductElement(item);
      catBlock.appendChild(li);
    });

    productContainer.appendChild(catBlock);
  });

  categoryOrder.forEach(category => {
    shoppingList
      .filter(i => i.toBuy && i.category === category && matchesSearch(i.name, search))
      .sort((a, b) => a.name.localeCompare(b.name, currentLang))
      .forEach(item => {
        const li = document.createElement("li");
        li.classList.add("product-item");
        li.dataset.id = item.id;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.addEventListener("change", () => toggleToBuy(item.id));

        const label = document.createElement("span");
        label.className = "product-label";
        label.textContent = item.name;

        const quantityInput = document.createElement("input");
        quantityInput.type = "number";
        quantityInput.className = "quantity-input";
        quantityInput.value = item.quantity || 1;
        quantityInput.min = "1";
        quantityInput.step = "1";
        quantityInput.addEventListener("change", () => updateQuantity(item.id, parseFloat(quantityInput.value) || 1));

        const unitSelect = document.createElement("select");
        unitSelect.className = "unit-select";
        
        const unitOptions = ["szt", "g", "ml", "kg", "l"];
        unitOptions.forEach(unit => {
          const option = document.createElement("option");
          option.value = unit;
          option.textContent = translations[currentLang].units[unit] || unit;
          unitSelect.appendChild(option);
        });
        
        unitSelect.value = item.unit || "szt";
        unitSelect.addEventListener("change", () => updateUnit(item.id, unitSelect.value));

        const star = document.createElement("span");
        star.className = "star-btn" + (item.starred ? " starred" : "");
        star.textContent = item.starred ? "★" : "☆";
        star.addEventListener("click", () => toggleStar(item.id));

        li.appendChild(checkbox);
        li.appendChild(label);
        li.appendChild(star);
        li.appendChild(quantityInput);
        li.appendChild(unitSelect);
        toBuyList.appendChild(li);
      });
  });
}

function renderCategoryOrderList() {
  const ul = document.getElementById("categoryOrderList");
  ul.innerHTML = "";

  categoryOrder.forEach(key => {
    const li = document.createElement("li");
    li.draggable = true;
    li.dataset.category = key;
    li.textContent = translations[currentLang].categories[key] || key;

    li.addEventListener("dragstart", () => li.classList.add("dragging"));
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      const newOrder = [...ul.querySelectorAll("li")].map(li => li.dataset.category);
      categoryOrder = newOrder;
      saveCategoryOrder();
      renderLists();
    });

    ul.appendChild(li);
  });

  ul.addEventListener("dragover", e => {
    e.preventDefault();
    const dragging = ul.querySelector(".dragging");
    const afterElement = getDragAfterElement(ul, e.clientY);
    if (afterElement == null) {
      ul.appendChild(dragging);
    } else {
      ul.insertBefore(dragging, afterElement);
    }
  });
  document.getElementById("categoryOrderList").style.display = "none";
}

function updateLanguageUI() {
  const t = translations[currentLang];

  document.querySelector(".sidebar h3").textContent = t.menu;
  document.querySelector(".sidebar h4.centered_text").textContent = t.settings;
  document.querySelectorAll(".sidebar h4.centered_text")[1].textContent = t.addProduct;
  document.querySelector("#itemName").placeholder = t.productPlaceholder;
  document.querySelector("#itemCategory").options[0].text = t.categoryPlaceholder;
  document.querySelector("#addItemForm button").textContent = t.addButton;
  document.querySelectorAll(".sidebar h4.centered_text")[2].textContent = t.switchOrder;
  document.querySelector(".main h2").textContent = t.toBuyTitle;
  document.querySelector(".product-list h3").textContent = t.allProducts;
  document.querySelector("#searchInput").placeholder = t.search;

  const isDark = document.body.classList.contains("dark-mode");
  document.querySelector("#themeToggle").textContent = isDark
    ? t.themeToggleLight
    : t.themeToggleDark;

  document.querySelector("#languageToggle").textContent = t.languageToggle;
  const undoBtn = document.querySelector("#undoButton");
  if (undoBtn) {
    undoBtn.textContent = t.undo;
    undoBtn.title = t.undoShortcutHint;
  }
  const authTitle = document.getElementById("authTitle");
  if (authTitle) authTitle.textContent = t.authTitle;
  const emailInput = document.getElementById("authEmail");
  if (emailInput) emailInput.placeholder = t.authEmailPlaceholder;
  const passwordInput = document.getElementById("authPassword");
  if (passwordInput) passwordInput.placeholder = t.authPasswordPlaceholder;
  const loginBtn = document.getElementById("loginButton");
  if (loginBtn) loginBtn.textContent = t.authLogin;
  const registerBtn = document.getElementById("registerButton");
  if (registerBtn) registerBtn.textContent = t.authRegister;
  const logoutBtn = document.getElementById("logoutButton");
  if (logoutBtn) logoutBtn.textContent = t.authLogout;
  const moreSettingsToggle = document.getElementById("moreSettingsToggle");
  const moreSettingsPanel = document.getElementById("moreSettingsPanel");
  if (moreSettingsToggle) {
    const isHidden = moreSettingsPanel && moreSettingsPanel.classList.contains("hidden");
    moreSettingsToggle.textContent = isHidden
      ? `${t.moreSettings} ▼`
      : `${t.moreSettings} ▲`;
  }
  const memberUidInput = document.getElementById("memberUidInput");
  if (memberUidInput) memberUidInput.placeholder = t.householdMemberPlaceholder;
  const addMemberButton = document.getElementById("addMemberButton");
  if (addMemberButton) addMemberButton.textContent = t.householdAddMember;

  const select = document.getElementById("itemCategory");
  for (let i = 1; i < select.options.length; i++) {
    const val = select.options[i].value;
    select.options[i].textContent = translations[currentLang].categories[val];
  }

  renderCategoryOrderList();
  renderLists();
}

// === CONTROLLER ===
function toggleCategoryOrderVisibility() {
  const list = document.getElementById("categoryOrderList");
  const icon = document.getElementById("toggleIcon");

  const isHidden = list.style.display === "none";
  list.style.display = isHidden ? "block" : "none";
  if (icon) icon.textContent = isHidden ? "▲" : "▼";
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll("li:not(.dragging)")];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function setupEventListeners() {
  document.getElementById("addItemForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = document.getElementById("itemName").value;
    const category = document.getElementById("itemCategory").value;
    if (!name || !category) return;
    await addProductToDB(name, category);
    e.target.reset();
    document.getElementById("itemName").focus();
  });

  const searchInput = document.getElementById("searchInput");
  const searchClear = document.getElementById("searchClear");
  const updateSearchClear = () => {
    searchClear.classList.toggle("visible", searchInput.value.length > 0);
  };
  searchInput.addEventListener("input", () => { updateSearchClear(); renderLists(); });
  searchInput.addEventListener("search", () => { updateSearchClear(); renderLists(); });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    updateSearchClear();
    renderLists();
    searchInput.focus();
  });

  document.getElementById("themeToggle").addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
    const isDark = document.body.classList.contains("dark-mode");
    document.getElementById("themeToggle").textContent = isDark
      ? translations[currentLang].themeToggleLight
      : translations[currentLang].themeToggleDark;
    localStorage.setItem("theme", isDark ? "dark" : "light");
  });

  document.getElementById("languageToggle").addEventListener("click", () => {
    currentLang = currentLang === "pl" ? "en" : "pl";
    localStorage.setItem("lang", currentLang);
    updateLanguageUI();
  });

  document.querySelector(".toggle-category-order")
    .addEventListener("click", toggleCategoryOrderVisibility);

  const moreSettingsToggle = document.getElementById("moreSettingsToggle");
  const moreSettingsPanel = document.getElementById("moreSettingsPanel");
  if (moreSettingsToggle && moreSettingsPanel) {
    moreSettingsToggle.addEventListener("click", () => {
      const isHidden = moreSettingsPanel.classList.toggle("hidden");
      const t = translations[currentLang];
      moreSettingsToggle.textContent = isHidden
        ? `${t.moreSettings} ▼`
        : `${t.moreSettings} ▲`;
    });
  }

  const loginBtn = document.getElementById("loginButton");
  const registerBtn = document.getElementById("registerButton");
  const authMessage = document.getElementById("authMessage");
  const authEmail = document.getElementById("authEmail");
  const authPassword = document.getElementById("authPassword");
  const authOverlay = document.getElementById("authOverlay");

  const showAuthError = error => {
    const errorCode = error && error.code ? error.code : "";
    let details = error && error.message ? error.message : "unknown";
    if (errorCode === "auth/unauthorized-domain") {
      details = "Domena nie jest dozwolona w Firebase Auth. Dodaj gilgaladea.github.io do Authorized domains.";
    } else if (errorCode === "auth/invalid-credential" || errorCode === "auth/wrong-password" || errorCode === "auth/user-not-found") {
      details = "Nieprawidlowy email lub haslo.";
    } else if (errorCode === "auth/email-already-in-use") {
      details = "Ten email jest juz zarejestrowany.";
    } else if (errorCode === "auth/weak-password") {
      details = "Haslo jest za slabe (minimum 6 znakow).";
    }
    authMessage.textContent = `${translations[currentLang].authErrorPrefix} ${details}${errorCode ? ` (${errorCode})` : ""}`;
  };

  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      try {
        authMessage.textContent = "";
        await signInWithEmailAndPassword(auth, authEmail.value.trim(), authPassword.value);
      } catch (error) {
        showAuthError(error);
      }
    });
  }

  if (registerBtn) {
    registerBtn.addEventListener("click", async () => {
      try {
        authMessage.textContent = "";
        await createUserWithEmailAndPassword(auth, authEmail.value.trim(), authPassword.value);
      } catch (error) {
        showAuthError(error);
      }
    });
  }

  const logoutBtn = document.getElementById("logoutButton");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
    });
  }

  const undoBtn = document.getElementById("undoButton");
  if (undoBtn) {
    undoBtn.addEventListener("click", undoLastChange);
  }

  const addMemberButton = document.getElementById("addMemberButton");
  const memberUidInput = document.getElementById("memberUidInput");
  if (addMemberButton) {
    addMemberButton.addEventListener("click", async () => {
      try {
        const result = await addMemberToHousehold(memberUidInput.value);
        if (result === null) {
          setHouseholdMessage(translations[currentLang].householdMemberExists);
        } else if (result) {
          setHouseholdMessage(translations[currentLang].householdMemberAdded);
          memberUidInput.value = "";
        }
      } catch (error) {
        setHouseholdMessage(`${translations[currentLang].householdActionError} ${error.message}`, true);
      }
    });
  }

  document.addEventListener("keydown", async e => {
    const isUndoShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey;
    if (!isUndoShortcut) return;
    if (isEditableElement(e.target)) return;
    e.preventDefault();
    await undoLastChange();
  });

  onAuthStateChanged(auth, async user => {
    if (!user) {
      appReady = false;
      currentUserId = "";
      householdId = "";
      shoppingList = [];
      undoStack.length = 0;
      try {
        localStorage.removeItem("shoppingListCache");
        localStorage.removeItem("categoryOrderCache");
      } catch (_) {}
      categoryOrder = [...defaultCategoryOrder];
      updateUndoUI();
      renderLists();
      if (shoppingUnsubscribe) {
        shoppingUnsubscribe();
        shoppingUnsubscribe = null;
      }
      updateHouseholdMetaUI();
      authOverlay.classList.remove("hidden");
      return;
    }

    authOverlay.classList.add("hidden");
    if (appReady) return;
    try {
      await ensureUserAndHousehold();
      appReady = true;
      setHouseholdMessage("");
      loadData();
    } catch (error) {
      appReady = false;
      const errorCode = error && error.code ? error.code : "";
      setHouseholdMessage(
        `${translations[currentLang].householdActionError} ${error.message}${errorCode ? ` (${errorCode})` : ""}`,
        true
      );
      if (errorCode === "permission-denied") {
        const authMessage = document.getElementById("authMessage");
        if (authMessage) {
          authMessage.textContent = "Brak uprawnien Firestore. Sprawdz, czy reguly opublikowano w projekcie shopping-list-c5094.";
        }
        await signOut(auth);
      }
      authOverlay.classList.remove("hidden");
    }
  });
}

// === INIT ===
document.addEventListener("DOMContentLoaded", async () => {
  currentLang = localStorage.getItem("lang") || "pl";
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "dark") document.body.classList.add("dark-mode");

  try {
    const cachedOrder = localStorage.getItem("categoryOrderCache");
    if (cachedOrder) {
      const parsed = JSON.parse(cachedOrder);
      if (Array.isArray(parsed) && parsed.length > 0) categoryOrder = parsed;
    }
  } catch (_) {}

  try {
    const cached = localStorage.getItem("shoppingListCache");
    if (cached) {
      shoppingList = JSON.parse(cached);
      renderLists();
    }
  } catch (_) {}

  setupEventListeners();
  updateUndoUI();
  updateLanguageUI();

  const container = document.querySelector('.container');
  const main = document.querySelector('.main');
  if (container && main) {
    container.scrollLeft = main.offsetLeft;
  }
  document.body.classList.add('loaded');
});
