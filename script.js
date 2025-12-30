// --- SAFEGUARDS & UTILS ---
const $ = (id) => document.getElementById(id);

// --- CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBvd0MSxwgvYA9XJTOy9_kDCMsBhD6Cuus",
  authDomain: "mathmaster-fnzyz.firebaseapp.com",
  projectId: "mathmaster-fnzyz",
  storageBucket: "mathmaster-fnzyz.firebasestorage.app",
  messagingSenderId: "669657651884",
  appId: "1:669657651884:web:32315bf8ef9bbbfdac9d09"
};

let app, auth, db;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

try {
    if (typeof firebase !== 'undefined') {
        app = firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore(app);
    } else {
        console.error("Firebase SDK missing");
    }
} catch (e) {
    console.error("Firebase Init Error:", e);
}

// --- STATE MANAGEMENT ---
let currentUser = null; 
let audioStarted = false;
let globalAchievements = []; // Loaded from DB
let profilePage = 0;
const ITEMS_PER_PAGE = 3;

let gameData = {
    active: false,
    timer: 60,
    score: 0,
    correct: 0,
    wrong: 0,
    currentQ: null,
    timerInterval: null,
    type: 'add',
    difficulty: 'easy'
};

// --- SCREEN NAVIGATION ---
const showScreen = (screenId) => {
    if (screenId === 'screen-menu' || screenId === 'screen-setup' || screenId === 'screen-auth') {
        stopAudio();
    }

    document.querySelectorAll('[id^="screen-"]').forEach(el => el.classList.add('hidden-screen'));
    const target = $(screenId);
    if(target) target.classList.remove('hidden-screen');
};

const showAdminSection = (section) => {
    if (section === 'users') {
        showScreen('screen-admin-users');
        loadAdminUsers();
    } else if (section === 'awards') {
        showScreen('screen-admin-awards');
        loadAdminAwards();
    }
};

const showAdminDashboard = () => showScreen('screen-admin');

// --- AUDIO LOGIC ---
function startAudio() {
    const bgAudio = document.getElementById('bg-music');
    if (!bgAudio) return;

    const savedVol = localStorage.getItem('mm_volume');
    if(savedVol !== null) {
        bgAudio.volume = parseFloat(savedVol);
        const slider = $('volume-slider');
        if(slider) slider.value = savedVol;
        updateVolumeUI(savedVol);
    } else {
        bgAudio.volume = 0.5;
    }

    if (!audioStarted) {
        const playPromise = bgAudio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => { audioStarted = true; }).catch(error => { });
        }
    }
}

function stopAudio() {
    const bgAudio = document.getElementById('bg-music');
    if (bgAudio) {
        bgAudio.pause();
        bgAudio.currentTime = 0;
        audioStarted = false;
    }
}

function toggleSettings() {
    const modal = $('settings-overlay');
    if (modal) modal.classList.toggle('hidden-screen');
}

function updateVolume(val) {
    const bgAudio = document.getElementById('bg-music');
    if (bgAudio) bgAudio.volume = val;
    updateVolumeUI(val);
    localStorage.setItem('mm_volume', val);
}

function updateVolumeUI(val) {
    const volVal = $('volume-value');
    if(volVal) volVal.innerText = Math.round(val * 100) + '%';
}

// --- MODAL UTILS ---
function closeModal() {
    $('modal-overlay').classList.add('hidden-screen');
}

function showModal(title, contentHTML) {
    $('modal-title').innerText = title;
    $('modal-content').innerHTML = contentHTML;
    $('modal-overlay').classList.remove('hidden-screen');
}

// --- AUTHENTICATION ---
async function initAuth() {
    stopAudio();
    if (!auth) return stopLoading();
    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await auth.signInWithCustomToken(__initial_auth_token);
        } else {
            if (!auth.currentUser) await auth.signInAnonymously();
        }
    } catch (error) { console.warn("Auth warning:", error); } 
    finally { stopLoading(); }
}

function stopLoading() {
    const loader = $('loadingOverlay');
    if (loader) loader.classList.add('hidden');
    setTimeout(() => {
        if(loader && !loader.classList.contains('hidden')) loader.classList.add('hidden');
    }, 500);
}

if (auth) {
    auth.onAuthStateChanged((user) => {
        if (!user) showScreen('screen-auth');
        stopLoading();
    });
}

async function handleRegister() {
    const u = $('auth-username').value.trim();
    const p = $('auth-password').value.trim();
    if(!u || !p) return showAuthError("Isi username & password!");
    if(u.length < 3) return showAuthError("Minimal 3 karakter.");

    $('loadingOverlay').classList.remove('hidden');
    try {
        const userRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('users');
        const snapshot = await userRef.where('username', '==', u).get();
        if (!snapshot.empty) throw new Error("Username sudah dipakai.");

        await userRef.add({
            username: u, password: p, role: 'user',
            createdAt: new Date().toISOString(), gamesPlayed: 0, highScore: 0, achievements: []
        });
        alert("Akun berhasil dibuat! Silakan login.");
        $('auth-password').value = '';
    } catch (e) { showAuthError(e.message); } 
    finally { stopLoading(); }
}

async function handleLogin() {
    const u = $('auth-username').value.trim();
    const p = $('auth-password').value.trim();
    if(!u || !p) return showAuthError("Isi data!");

    $('loadingOverlay').classList.remove('hidden');
    try {
        const userRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('users');
        const snapshot = await userRef.where('username', '==', u).where('password', '==', p).get();
        if (snapshot.empty) throw new Error("Akun tidak ditemukan.");

        const doc = snapshot.docs[0];
        currentUser = { id: doc.id, ...doc.data(), isGuest: false };
        await initAchievements(); // Load achievements on login
        loginSuccess();
    } catch (e) { showAuthError(e.message); } 
    finally { stopLoading(); }
}

function startGuestMode() {
    currentUser = { id: 'guest_' + Date.now(), username: 'Tamu', role: 'guest', isGuest: true, gamesPlayed: 0, highScore: 0, achievements: [] };
    initAchievements().then(loginSuccess);
}

function loginSuccess() {
    stopAudio();
    $('display-username').innerText = currentUser.username;
    $('user-role-badge').innerText = currentUser.role === 'admin' ? 'Administrator' : (currentUser.isGuest ? 'Mode Tamu' : 'Pemain Terdaftar');
    
    // Admin Button & LB Actions
    const adminBtn = $('btn-admin-panel');
    const lbAdd = $('lb-admin-add');
    if (currentUser.role === 'admin') {
        if(adminBtn) adminBtn.classList.remove('hidden-screen');
        if(lbAdd) lbAdd.classList.remove('hidden');
    } else {
        if(adminBtn) adminBtn.classList.add('hidden-screen');
        if(lbAdd) lbAdd.classList.add('hidden');
    }
    showScreen('screen-menu');
}

function handleLogout() {
    currentUser = null;
    $('auth-username').value = '';
    $('auth-password').value = '';
    stopAudio();
    showScreen('screen-auth');
}

function showAuthError(msg) {
    const msgEl = $('auth-message');
    if(msgEl) {
        msgEl.innerText = msg;
        setTimeout(() => msgEl.innerText = '', 3000);
    }
}

// --- ACHIEVEMENT LOGIC (DYNAMIC) ---

async function initAchievements() {
    // Fetch achievements from DB, or seed if empty
    if(!db) return;
    const achRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('achievements');
    
    try {
        const snap = await achRef.get();
        if (snap.empty) {
            // Seed defaults
            const defaults = [
                { title: 'Langkah Pertama', desc: 'Mainkan game pertama', formula: 'gamesPlayed >= 1' },
                { title: 'Ahli Matematika', desc: 'Skor > 50', formula: 'score > 50' },
                { title: 'Centurion', desc: 'Skor > 100', formula: 'score > 100' },
                { title: 'Veteran', desc: 'Main 10x', formula: 'gamesPlayed >= 10' }
            ];
            for (const d of defaults) await achRef.add(d);
            globalAchievements = defaults; // Use defaults locally for now
        } else {
            globalAchievements = snap.docs.map(d => ({id: d.id, ...d.data()}));
        }
    } catch(e) { console.error("Ach load error", e); }
}

function evaluateFormula(formula, context) {
    // context = { score, gamesPlayed, difficulty, type }
    // formula ex: "score > 50, difficulty = hard"
    try {
        const parts = formula.split(',').map(s => s.trim());
        for (const part of parts) {
            let operator, key, value;
            if (part.includes('>=')) operator = '>=';
            else if (part.includes('<=')) operator = '<=';
            else if (part.includes('>')) operator = '>';
            else if (part.includes('<')) operator = '<';
            else if (part.includes('=')) operator = '=';
            else return false; // Invalid syntax

            [key, value] = part.split(operator).map(s => s.trim());
            
            // Cast value
            if (!isNaN(value)) value = Number(value);
            
            // Compare
            const contextVal = context[key];
            if (contextVal === undefined) return false;

            if (operator === '>=' && !(contextVal >= value)) return false;
            if (operator === '<=' && !(contextVal <= value)) return false;
            if (operator === '>' && !(contextVal > value)) return false;
            if (operator === '<' && !(contextVal < value)) return false;
            if (operator === '=' && !(contextVal == value)) return false; // Loose equality for string/num
        }
        return true;
    } catch (e) {
        console.warn("Formula error:", formula, e);
        return false;
    }
}

// --- GAMEPLAY LOGIC ---
function showGameSetup() { stopAudio(); showScreen('screen-setup'); }

function selectDifficulty(diff, btn) {
    gameData.difficulty = diff;
    document.querySelectorAll('.diff-btn').forEach(b => {
        b.classList.remove('bg-green-100', 'border-green-500', 'text-green-700', 'active-diff');
        b.classList.add('bg-white', 'border-gray-200', 'text-gray-500');
    });
    btn.classList.remove('bg-white', 'border-gray-200', 'text-gray-500');
    btn.classList.add('bg-green-100', 'border-green-500', 'text-green-700', 'active-diff');
}

function startGame() {
    gameData.type = $('game-type').value;
    const timers = { 'easy': 60, 'medium': 90, 'hard': 120 };
    gameData.timer = timers[gameData.difficulty] || 60;
    gameData.score = 0; gameData.correct = 0; gameData.wrong = 0; gameData.active = true;

    $('game-score').innerText = '0';
    $('game-timer').innerText = gameData.timer;
    $('answer-display').innerText = '';
    $('feedback-msg').innerText = '';

    showScreen('screen-game');
    generateQuestion();
    startAudio();

    if (gameData.timerInterval) clearInterval(gameData.timerInterval);
    gameData.timerInterval = setInterval(() => {
        gameData.timer--;
        $('game-timer').innerText = gameData.timer;
        if (gameData.timer <= 0) endGame();
    }, 1000);
}

function generateQuestion() {
    let n1, n2, operator;
    const diff = gameData.difficulty;
    const type = gameData.type;
    let max = diff === 'easy' ? 10 : (diff === 'medium' ? 50 : 100);
    let min = diff === 'hard' ? -50 : 1;

    let ops = [];
    if(type === 'add') ops = ['+'];
    else if(type === 'sub') ops = ['-'];
    else if(type === 'mul') ops = ['*'];
    else if(type === 'div') ops = ['/'];
    else if(type === 'addsub') ops = ['+', '-'];
    else if(type === 'muldiv') ops = ['*', '/'];
    else ops = ['+', '-', '*', '/'];

    operator = ops[Math.floor(Math.random() * ops.length)];

    if (operator === '/') {
        n2 = Math.floor(Math.random() * (max/2)) + 2;
        const factor = Math.floor(Math.random() * (max/2)) + 1;
        n1 = n2 * factor;
    } else if (operator === '*') {
        let mulMax = diff === 'easy' ? 9 : (diff === 'medium' ? 12 : 20);
        n1 = Math.floor(Math.random() * mulMax) + 1;
        n2 = Math.floor(Math.random() * mulMax) + 1;
    } else {
        n1 = Math.floor(Math.random() * (max - min + 1)) + min;
        n2 = Math.floor(Math.random() * (max - min + 1)) + min;
        if(operator === '-' && diff !== 'hard' && n2 > n1) [n1, n2] = [n2, n1];
    }

    let ans;
    switch(operator) {
        case '+': ans = n1 + n2; break;
        case '-': ans = n1 - n2; break;
        case '*': ans = n1 * n2; break;
        case '/': ans = n1 / n2; break;
    }

    let displayOp = operator;
    if (operator === '*') displayOp = '×';
    if (operator === '/') displayOp = '÷';
    let qText = `${n1} ${displayOp} ${n2 < 0 ? '('+n2+')' : n2}`;
    gameData.currentQ = { q: qText, a: ans };
    $('question-display').innerText = `${qText} = ?`;
}

function inputNumber(num) {
    const disp = $('answer-display');
    if (disp.innerText.length < 6) disp.innerText += num;
}
function inputClear() { $('answer-display').innerText = ''; }

function submitAnswer() {
    if (!gameData.active) return;
    const userAns = parseInt($('answer-display').innerText);
    if (isNaN(userAns)) return;

    if (userAns === gameData.currentQ.a) {
        const points = gameData.difficulty === 'easy' ? 10 : (gameData.difficulty === 'medium' ? 20 : 30);
        gameData.score += points;
        gameData.correct++;
        $('feedback-msg').innerText = "Benar!";
        $('feedback-msg').className = "h-6 mt-2 font-bold text-sm text-green-500";
    } else {
        gameData.score = Math.max(0, gameData.score - 5);
        gameData.wrong++;
        $('feedback-msg').innerText = "Salah!";
        $('feedback-msg').className = "h-6 mt-2 font-bold text-sm text-red-500";
    }
    $('game-score').innerText = gameData.score;
    $('answer-display').innerText = '';
    generateQuestion();
}

function endGame() {
    clearInterval(gameData.timerInterval);
    gameData.active = false;
    stopAudio();
    $('final-score').innerText = gameData.score;
    $('final-correct').innerText = gameData.correct;
    $('final-wrong').innerText = gameData.wrong;
    const achBox = $('achievement-unlocked');
    if(achBox) achBox.classList.add('hidden');
    showScreen('screen-result');
    if (currentUser && !currentUser.isGuest) saveGameData();
}

async function saveGameData() {
    if(!db) return;
    const scoreRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('scores');
    const userRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('users').doc(currentUser.id);

    await scoreRef.add({
        userId: currentUser.id, username: currentUser.username, score: gameData.score,
        type: gameData.type, difficulty: gameData.difficulty, date: new Date().toISOString()
    });

    try {
        const uSnap = await userRef.get();
        if(uSnap.exists) {
            const uData = uSnap.data();
            let newGamesPlayed = (uData.gamesPlayed || 0) + 1;
            let newHighScore = Math.max((uData.highScore || 0), gameData.score);
            let currentAchievements = uData.achievements || [];
            let newlyUnlocked = [];

            // Context for formula
            const context = {
                score: gameData.score,
                gamesPlayed: newGamesPlayed,
                difficulty: gameData.difficulty,
                type: gameData.type
            };

            globalAchievements.forEach(ach => {
                if (!currentAchievements.some(ca => ca === ach.id || ca.title === ach.title)) {
                    if (evaluateFormula(ach.formula, context)) {
                        newlyUnlocked.push(ach);
                        currentAchievements.push(ach.id || ach.title); // Prefer ID
                    }
                }
            });

            await userRef.update({ gamesPlayed: newGamesPlayed, highScore: newHighScore, achievements: currentAchievements });
            currentUser.gamesPlayed = newGamesPlayed;
            currentUser.highScore = newHighScore;
            currentUser.achievements = currentAchievements;

            if (newlyUnlocked.length > 0) {
                const ach = newlyUnlocked[0];
                $('achievement-text').innerText = ach.title;
                $('achievement-unlocked').classList.remove('hidden');
            }
        }
    } catch(e) { console.error("Save error", e); }
}

// --- PROFILE & PAGINATION ---
function showProfile() {
    showScreen('screen-profile');
    $('profile-username').innerText = currentUser.username;
    $('profile-joined').innerText = currentUser.isGuest ? 'Tamu' : new Date(currentUser.createdAt).toLocaleDateString('id-ID');
    $('stat-games').innerText = currentUser.gamesPlayed || 0;
    $('stat-high').innerText = currentUser.highScore || 0;
    profilePage = 0;
    renderProfileAchievements();
}

function renderProfileAchievements() {
    const list = $('achievement-list');
    list.innerHTML = '';
    
    // Get unlocked achievements details from global list
    const myAchIds = currentUser.achievements || [];
    // Map IDs back to full objects
    let unlockedObjs = globalAchievements.filter(ga => myAchIds.includes(ga.id) || myAchIds.includes(ga.title));
    
    const totalPages = Math.ceil(unlockedObjs.length / ITEMS_PER_PAGE) || 1;
    $('page-indicator').innerText = `${profilePage + 1}/${totalPages}`;
    $('btn-prev-page').disabled = profilePage === 0;
    $('btn-next-page').disabled = profilePage >= totalPages - 1;

    const start = profilePage * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageItems = unlockedObjs.slice(start, end);

    if (pageItems.length === 0) {
        list.innerHTML = '<p class="text-center text-gray-400 text-sm mt-4">Belum ada penghargaan.</p>';
        return;
    }

    pageItems.forEach(ach => {
        list.innerHTML += `
            <div class="flex items-center p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                <div class="mr-3 text-2xl text-yellow-500"><i class="fas fa-medal"></i></div>
                <div>
                    <div class="font-bold text-gray-800">${ach.title}</div>
                    <div class="text-xs text-gray-500">${ach.desc}</div>
                </div>
            </div>`;
    });
}

function changeProfilePage(dir) {
    profilePage += dir;
    renderProfileAchievements();
}

// --- LEADERBOARD & ADMIN ---
async function loadLeaderboard() {
    const filterType = $('lb-filter-type').value;
    const filterDiff = $('lb-filter-diff').value;
    const list = $('leaderboard-list');
    list.innerHTML = '';
    $('lb-loading').classList.remove('hidden');

    try {
        let query = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('scores');
        const snapshot = await query.orderBy('date', 'desc').limit(50).get();
        let scores = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));

        scores = scores.filter(s => {
            let matchType = filterType === 'all' || s.type === filterType;
            let matchDiff = filterDiff === 'all' || s.difficulty === filterDiff;
            return matchType && matchDiff;
        });

        scores.sort((a, b) => b.score - a.score);

        scores.slice(0, 20).forEach((s, index) => {
            let medal = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : index + 1));
            // Admin Controls
            let controls = '';
            if (currentUser && currentUser.role === 'admin') {
                controls = `
                    <div class="flex flex-col gap-1 ml-2">
                        <button onclick="modalEditScore('${s.id}', ${s.score})" class="text-blue-500 text-xs"><i class="fas fa-edit"></i></button>
                        <button onclick="deleteScore('${s.id}')" class="text-red-500 text-xs"><i class="fas fa-trash"></i></button>
                    </div>`;
            }

            const row = `
                <tr class="border-b bg-white hover:bg-gray-50">
                    <td class="px-3 py-3 font-bold text-gray-600">${medal}</td>
                    <td class="px-3 py-3">
                        <div class="font-bold text-gray-800">${s.username}</div>
                        <div class="text-xs text-gray-400">${s.type} • ${s.difficulty}</div>
                    </td>
                    <td class="px-3 py-3 text-right font-bold text-indigo-600 flex justify-end items-center">
                        ${s.score} ${controls}
                    </td>
                </tr>`;
            list.innerHTML += row;
        });

        if(scores.length === 0) list.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-400">Belum ada data</td></tr>';
    } catch (e) { console.error(e); } 
    finally { $('lb-loading').classList.add('hidden'); }
}

function showLeaderboard() { showScreen('screen-leaderboard'); loadLeaderboard(); }

// --- ADMIN LEADERBOARD FUNCTIONS ---
async function deleteScore(id) {
    if(!confirm("Hapus skor ini?")) return;
    await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('scores').doc(id).delete();
    loadLeaderboard();
}

function modalAddScore() {
    showModal('Tambah Skor Manual', `
        <label class="modal-label">Username</label>
        <input id="add-score-user" class="modal-input" placeholder="Nama User">
        <label class="modal-label">Skor</label>
        <input id="add-score-val" type="number" class="modal-input" placeholder="0">
        <button onclick="execAddScore()" class="w-full bg-green-500 text-white p-2 rounded">Simpan</button>
    `);
}

async function execAddScore() {
    const u = $('add-score-user').value;
    const s = parseInt($('add-score-val').value);
    if (!u || isNaN(s)) return alert("Data tidak valid");
    await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('scores').add({
        userId: 'admin_manual', username: u, score: s, type: 'manual', difficulty: '-', date: new Date().toISOString()
    });
    closeModal();
    loadLeaderboard();
}

function modalEditScore(id, oldScore) {
    showModal('Edit Skor', `
        <label class="modal-label">Skor Baru</label>
        <input id="edit-score-val" type="number" class="modal-input" value="${oldScore}">
        <button onclick="execEditScore('${id}')" class="w-full bg-blue-500 text-white p-2 rounded">Update</button>
    `);
}

async function execEditScore(id) {
    const s = parseInt($('edit-score-val').value);
    await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('scores').doc(id).update({score: s});
    closeModal();
    loadLeaderboard();
}

// --- ADMIN USERS FUNCTIONS ---
async function loadAdminUsers() {
    const list = $('admin-user-list');
    list.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i></div>';
    const ref = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('users');
    const snap = await ref.orderBy('createdAt', 'desc').get();
    
    list.innerHTML = '';
    snap.forEach(doc => {
        const u = doc.data();
        const roleColor = u.role === 'admin' ? 'text-red-600 bg-red-100' : 'text-gray-600 bg-gray-100';
        list.innerHTML += `
            <div class="bg-white p-3 rounded-lg shadow-sm flex justify-between items-center border">
                <div>
                    <div class="font-bold text-gray-800">${u.username} <span class="text-xs px-2 rounded ${roleColor}">${u.role}</span></div>
                    <div class="text-xs text-gray-500">Pass: ${u.password}</div>
                </div>
                <button onclick="deleteUser('${doc.id}')" class="text-red-500 hover:bg-red-50 p-2 rounded"><i class="fas fa-trash"></i></button>
            </div>`;
    });
}

function modalAddUser() {
    showModal('Tambah User Baru', `
        <label class="modal-label">Username</label>
        <input id="new-u-name" class="modal-input">
        <label class="modal-label">Password</label>
        <input id="new-u-pass" class="modal-input">
        <label class="modal-label">Role</label>
        <select id="new-u-role" class="modal-input bg-white"><option value="user">User Biasa</option><option value="admin">Administrator</option></select>
        <button onclick="execAddUser()" class="w-full bg-indigo-600 text-white p-2 rounded">Buat Akun</button>
    `);
}

async function execAddUser() {
    const u = $('new-u-name').value;
    const p = $('new-u-pass').value;
    const r = $('new-u-role').value;
    if(!u || !p) return alert("Lengkapi data");
    
    const userRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('users');
    const check = await userRef.where('username', '==', u).get();
    if(!check.empty) return alert("Username ada");

    await userRef.add({
        username: u, password: p, role: r, createdAt: new Date().toISOString(), gamesPlayed: 0, highScore: 0, achievements: []
    });
    closeModal();
    loadAdminUsers();
}

async function deleteUser(uid) {
    if(!confirm("Hapus pengguna ini selamanya?")) return;
    await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('users').doc(uid).delete();
    loadAdminUsers();
}

// --- ADMIN AWARDS FUNCTIONS ---
async function loadAdminAwards() {
    const list = $('admin-award-list');
    list.innerHTML = 'Loading...';
    await initAchievements(); // Refresh global list
    list.innerHTML = '';
    
    globalAchievements.forEach(a => {
        list.innerHTML += `
            <div class="bg-white p-3 rounded-lg shadow-sm border mb-2">
                <div class="flex justify-between">
                    <div class="font-bold text-indigo-700">${a.title}</div>
                    <div class="flex gap-2">
                        <button onclick="modalEditAward('${a.id}')" class="text-blue-500"><i class="fas fa-edit"></i></button>
                        <button onclick="deleteAward('${a.id}')" class="text-red-500"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <div class="text-sm text-gray-600">${a.desc}</div>
                <div class="text-xs text-gray-400 font-mono mt-1 bg-gray-50 p-1 rounded">Rumus: ${a.formula}</div>
            </div>`;
    });
}

function modalAddAward() {
    showModal('Tambah Penghargaan', `
        <label class="modal-label">Nama Penghargaan</label>
        <input id="aw-title" class="modal-input">
        <label class="modal-label">Deskripsi</label>
        <input id="aw-desc" class="modal-input">
        <label class="modal-label">Formula</label>
        <input id="aw-form" class="modal-input" placeholder="ex: score > 100">
        <button onclick="execSaveAward()" class="w-full bg-yellow-500 text-white p-2 rounded">Simpan</button>
    `);
}

function modalEditAward(id) {
    const a = globalAchievements.find(x => x.id === id);
    if(!a) return;
    showModal('Edit Penghargaan', `
        <input type="hidden" id="aw-id" value="${id}">
        <label class="modal-label">Nama Penghargaan</label>
        <input id="aw-title" class="modal-input" value="${a.title}">
        <label class="modal-label">Deskripsi</label>
        <input id="aw-desc" class="modal-input" value="${a.desc}">
        <label class="modal-label">Formula</label>
        <input id="aw-form" class="modal-input" value="${a.formula}">
        <button onclick="execSaveAward()" class="w-full bg-blue-500 text-white p-2 rounded">Update</button>
    `);
}

async function execSaveAward() {
    const id = $('aw-id') ? $('aw-id').value : null;
    const title = $('aw-title').value;
    const desc = $('aw-desc').value;
    const formula = $('aw-form').value;

    if(!title || !formula) return alert("Data kurang lengkap");

    const ref = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('achievements');
    if(id) {
        await ref.doc(id).update({title, desc, formula});
    } else {
        await ref.add({title, desc, formula});
    }
    closeModal();
    loadAdminAwards();
}

async function deleteAward(id) {
    if(!confirm("Hapus penghargaan ini?")) return;
    await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('achievements').doc(id).delete();
    loadAdminAwards();
}

// Initial Start
document.addEventListener('DOMContentLoaded', () => initAuth());
