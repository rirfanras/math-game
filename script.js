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

// Initialize Firebase safely
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

const achievementsList = [
    { id: 'first_blood', title: 'Langkah Pertama', desc: 'Mainkan game pertama kamu', req: (stats) => stats.gamesPlayed >= 1 },
    { id: 'math_wiz', title: 'Ahli Matematika', desc: 'Dapatkan skor > 50', req: (stats, score) => score > 50 },
    { id: 'century', title: 'Centurion', desc: 'Dapatkan skor > 100', req: (stats, score) => score > 100 },
    { id: 'veteran', title: 'Veteran', desc: 'Mainkan 10 game', req: (stats) => stats.gamesPlayed >= 10 }
];

// --- SCREEN NAVIGATION ---
const showScreen = (screenId) => {
    document.querySelectorAll('[id^="screen-"]').forEach(el => el.classList.add('hidden-screen'));
    const target = $(screenId);
    if(target) target.classList.remove('hidden-screen');
};

// --- AUDIO LOGIC (SAFE MODE) ---
function startAudio() {
    // Ambil elemen audio secara dinamis (Lazy fetch) untuk menghindari error null di awal
    const bgAudio = document.getElementById('bg-music');
    
    if (!bgAudio) {
        console.warn("Element audio tidak ditemukan di HTML");
        return;
    }

    if (!audioStarted) {
        bgAudio.volume = 0.5; // Default volume
        
        // Load saved volume
        const savedVol = localStorage.getItem('mm_volume');
        if(savedVol !== null) {
            bgAudio.volume = parseFloat(savedVol);
            const slider = $('volume-slider');
            if(slider) slider.value = savedVol;
            updateVolumeUI(savedVol);
        }

        // COBA PUTAR, TAPI JANGAN CRASH JIKA GAGAL
        const playPromise = bgAudio.play();

        if (playPromise !== undefined) {
            playPromise.then(() => {
                // Audio berhasil diputar
                audioStarted = true;
                console.log("Audio playing");
            }).catch(error => {
                // Audio diblokir browser (Autoplay Policy). 
                // Ini NORMAL jika user belum klik apapun. Jangan biarkan ini menghentikan script.
                console.log("Audio autoplay dicegah browser. Menunggu interaksi user.");
                audioStarted = false; 
            });
        }
    }
}

function toggleSettings() {
    const modal = $('settings-overlay');
    if (modal) modal.classList.toggle('hidden-screen');
}

function updateVolume(val) {
    const bgAudio = document.getElementById('bg-music');
    if (bgAudio) {
        bgAudio.volume = val;
        // Jika audio belum jalan karena autoplay block, paksa jalan saat user geser slider
        if (!audioStarted) {
            bgAudio.play().then(() => audioStarted = true).catch(() => {});
        }
    }
    updateVolumeUI(val);
    localStorage.setItem('mm_volume', val);
}

function updateVolumeUI(val) {
    const volVal = $('volume-value');
    if(volVal) volVal.innerText = Math.round(val * 100) + '%';
}

// --- AUTHENTICATION LOGIC ---

async function initAuth() {
    if (!auth) return stopLoading();

    try {
        // Cek token bawaan (untuk environment khusus)
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await auth.signInWithCustomToken(__initial_auth_token);
        } else {
            // Hanya login anonim jika belum ada user
            if (!auth.currentUser) {
                await auth.signInAnonymously();
            }
        }
    } catch (error) {
        console.warn("Auth warning:", error);
    } finally {
        // PENTING: Apa pun yang terjadi, matikan loading screen!
        stopLoading();
    }
}

// Helper untuk mematikan loading
function stopLoading() {
    const loader = $('loadingOverlay');
    if (loader) loader.classList.add('hidden');
    
    // Failsafe: Jika loader masih ada setelah 500ms, paksa hilang
    setTimeout(() => {
        if(loader && !loader.classList.contains('hidden')) loader.classList.add('hidden');
    }, 500);
}

// Event Listener auth state
if (auth) {
    auth.onAuthStateChanged((user) => {
        if (user) {
            // User login/terdeteksi
            // Cek apakah data user ada di DB untuk menentukan role
            checkUserProfile(user);
        } else {
            // User logout
            showScreen('screen-auth');
        }
        stopLoading(); // Pastikan loading hilang setiap status berubah
    });
}

async function checkUserProfile(firebaseUser) {
    // Jika anonymous auth tanpa profil DB (Guest fresh)
    if (firebaseUser.isAnonymous && !currentUser) {
         // Kita anggap sementara guest sampai user login beneran
         // Tapi karena struktur kode sebelumnya manual, kita biarkan logic handleLogin menangani
    }
}


async function handleRegister() {
    const u = $('auth-username').value.trim();
    const p = $('auth-password').value.trim();
    
    if(!u || !p) return showAuthError("Username dan password harus diisi!");
    if(u.length < 3) return showAuthError("Username minimal 3 karakter.");

    $('loadingOverlay').classList.remove('hidden');

    try {
        const userRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('users');
        const snapshot = await userRef.where('username', '==', u).get();

        if (!snapshot.empty) {
            throw new Error("Username sudah dipakai.");
        }

        const newUser = {
            username: u,
            password: p, 
            role: u.toLowerCase() === 'admin' ? 'admin' : 'user',
            createdAt: new Date().toISOString(),
            gamesPlayed: 0,
            highScore: 0,
            achievements: []
        };

        await userRef.add(newUser);
        alert("Akun berhasil dibuat! Silakan login.");
        $('auth-password').value = '';
    } catch (e) {
        showAuthError(e.message);
    } finally {
        stopLoading();
    }
}

async function handleLogin() {
    const u = $('auth-username').value.trim();
    const p = $('auth-password').value.trim();

    if(!u || !p) return showAuthError("Isi semua data!");

    $('loadingOverlay').classList.remove('hidden');

    try {
        // Cek DB manual (simulasi login via Firestore query)
        const userRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('users');
        const snapshot = await userRef.where('username', '==', u).where('password', '==', p).get();

        if (snapshot.empty) {
            throw new Error("Username atau password salah.");
        }

        const doc = snapshot.docs[0];
        currentUser = { id: doc.id, ...doc.data(), isGuest: false };
        
        loginSuccess();

    } catch (e) {
        showAuthError(e.message);
    } finally {
        stopLoading();
    }
}

function startGuestMode() {
    currentUser = { 
        id: 'guest_' + Date.now(), 
        username: 'Tamu', 
        role: 'guest', 
        isGuest: true,
        gamesPlayed: 0, 
        highScore: 0, 
        achievements: [] 
    };
    loginSuccess();
}

function loginSuccess() {
    // Mencoba memutar audio. 
    // Karena fungsi ini dipanggil setelah klik tombol (Login/Guest), kemungkinan besar browser mengizinkan audio.
    startAudio(); 

    $('display-username').innerText = currentUser.username;
    $('user-role-badge').innerText = currentUser.role === 'admin' ? 'Administrator' : (currentUser.isGuest ? 'Mode Tamu' : 'Pemain Terdaftar');
    
    const adminBtn = $('btn-admin-panel');
    if (adminBtn) {
        if(currentUser.role === 'admin') {
            adminBtn.classList.remove('hidden-screen');
        } else {
            adminBtn.classList.add('hidden-screen');
        }
    }

    showScreen('screen-menu');
}

function handleLogout() {
    currentUser = null;
    $('auth-username').value = '';
    $('auth-password').value = '';
    $('auth-message').innerText = '';
    showScreen('screen-auth');
    // Opsional: Matikan musik saat logout
    // const bgAudio = document.getElementById('bg-music');
    // if(bgAudio) bgAudio.pause();
    // audioStarted = false;
}

function showAuthError(msg) {
    const msgEl = $('auth-message');
    if(msgEl) {
        msgEl.innerText = msg;
        setTimeout(() => msgEl.innerText = '', 3000);
    }
}

// --- GAMEPLAY LOGIC ---

function showGameSetup() {
    showScreen('screen-setup');
    // Pastikan audio jalan lagi (berjaga-jaga jika autoplay block saat login)
    startAudio();
}

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
    gameData.timer = 60;
    gameData.score = 0;
    gameData.correct = 0;
    gameData.wrong = 0;
    gameData.active = true;

    $('game-score').innerText = '0';
    $('game-timer').innerText = '60';
    $('answer-display').innerText = '';
    $('feedback-msg').innerText = '';

    showScreen('screen-game');
    generateQuestion();
    
    // Start Timer
    if (gameData.timerInterval) clearInterval(gameData.timerInterval);
    gameData.timerInterval = setInterval(() => {
        gameData.timer--;
        $('game-timer').innerText = gameData.timer;
        if (gameData.timer <= 0) endGame();
    }, 1000);
    
    // Satu lagi upaya play audio, karena tombol "Mulai" adalah interaksi user yang kuat
    startAudio();
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
        if(operator === '-' && diff !== 'hard' && n2 > n1) {
            [n1, n2] = [n2, n1];
        }
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
    if (disp.innerText.length < 6) {
        disp.innerText += num;
    }
}

function inputClear() {
    $('answer-display').innerText = '';
}

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
    
    $('final-score').innerText = gameData.score;
    $('final-correct').innerText = gameData.correct;
    $('final-wrong').innerText = gameData.wrong;
    const achUnlocked = $('achievement-unlocked');
    if(achUnlocked) achUnlocked.classList.add('hidden');

    showScreen('screen-result');

    if (currentUser && !currentUser.isGuest) {
        saveGameData();
    }
}

async function saveGameData() {
    if(!db) return; 

    const scoreRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('scores');
    const userRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('users').doc(currentUser.id);

    await scoreRef.add({
        userId: currentUser.id,
        username: currentUser.username,
        score: gameData.score,
        type: gameData.type,
        difficulty: gameData.difficulty,
        date: new Date().toISOString()
    });

    try {
        const uSnap = await userRef.get();
        if(uSnap.exists) {
            const uData = uSnap.data();
            let newGamesPlayed = (uData.gamesPlayed || 0) + 1;
            let newHighScore = Math.max((uData.highScore || 0), gameData.score);
            let currentAchievements = uData.achievements || [];

            let newlyUnlocked = [];
            achievementsList.forEach(ach => {
                if (!currentAchievements.includes(ach.id)) {
                    if (ach.req({ gamesPlayed: newGamesPlayed }, gameData.score)) {
                        newlyUnlocked.push(ach);
                        currentAchievements.push(ach.id);
                    }
                }
            });

            await userRef.update({
                gamesPlayed: newGamesPlayed,
                highScore: newHighScore,
                achievements: currentAchievements
            });

            currentUser.gamesPlayed = newGamesPlayed;
            currentUser.highScore = newHighScore;
            currentUser.achievements = currentAchievements;

            if (newlyUnlocked.length > 0) {
                const ach = newlyUnlocked[0]; 
                const achText = $('achievement-text');
                const achBox = $('achievement-unlocked');
                if(achText) achText.innerText = ach.title;
                if(achBox) achBox.classList.remove('hidden');
            }
        }
    } catch(e) {
        console.error("Save error", e);
    }
}

async function loadLeaderboard() {
    const filterType = $('lb-filter-type').value;
    const filterDiff = $('lb-filter-diff').value;
    const list = $('leaderboard-list');
    
    list.innerHTML = '';
    const loader = $('lb-loading');
    if(loader) loader.classList.remove('hidden');

    try {
        let query = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('scores');
        const snapshot = await query.orderBy('date', 'desc').limit(100).get();
        
        let scores = [];
        snapshot.forEach(doc => {
            scores.push(doc.data());
        });

        scores = scores.filter(s => {
            let matchType = filterType === 'all' || s.type === filterType;
            let matchDiff = filterDiff === 'all' || s.difficulty === filterDiff;
            return matchType && matchDiff;
        });

        scores.sort((a, b) => b.score - a.score);

        scores.slice(0, 20).forEach((s, index) => {
            let medal = '';
            if (index === 0) medal = '🥇';
            else if (index === 1) medal = '🥈';
            else if (index === 2) medal = '🥉';
            else medal = index + 1;

            const row = `
                <tr class="border-b bg-white hover:bg-gray-50">
                    <td class="px-3 py-3 font-bold text-gray-600">${medal}</td>
                    <td class="px-3 py-3">
                        <div class="font-bold text-gray-800">${s.username}</div>
                        <div class="text-xs text-gray-400">${s.type} • ${s.difficulty}</div>
                    </td>
                    <td class="px-3 py-3 text-right font-bold text-indigo-600">${s.score}</td>
                </tr>
            `;
            list.innerHTML += row;
        });

        if(scores.length === 0) {
            list.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-400">Belum ada data</td></tr>';
        }

    } catch (e) {
        console.error(e);
        list.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-red-400">Gagal memuat</td></tr>';
    } finally {
        if(loader) loader.classList.add('hidden');
    }
}

function showLeaderboard() {
    showScreen('screen-leaderboard');
    loadLeaderboard();
}

function showProfile() {
    showScreen('screen-profile');
    
    $('profile-username').innerText = currentUser.username;
    $('profile-joined').innerText = currentUser.isGuest ? 'Tamu' : new Date(currentUser.createdAt).toLocaleDateString('id-ID');
    $('stat-games').innerText = currentUser.gamesPlayed || 0;
    $('stat-high').innerText = currentUser.highScore || 0;

    const achList = $('achievement-list');
    achList.innerHTML = '';

    const myAch = currentUser.achievements || [];
    
    achievementsList.forEach(ach => {
        const unlocked = myAch.includes(ach.id);
        const item = `
            <div class="flex items-center p-3 rounded-lg ${unlocked ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-100 opacity-60'}">
                <div class="mr-3 text-2xl ${unlocked ? 'text-yellow-500' : 'text-gray-400'}">
                    <i class="fas fa-medal"></i>
                </div>
                <div>
                    <div class="font-bold ${unlocked ? 'text-gray-800' : 'text-gray-500'}">${ach.title}</div>
                    <div class="text-xs text-gray-500">${ach.desc}</div>
                </div>
                ${unlocked ? '<div class="ml-auto text-green-500"><i class="fas fa-check"></i></div>' : ''}
            </div>
        `;
        achList.innerHTML += item;
    });
}

function showAdminPanel() {
    if (!currentUser || currentUser.role !== 'admin') return;
    showScreen('screen-admin');
    loadUserList();
}

async function loadUserList() {
    const list = $('admin-user-list');
    list.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i></div>';
    
    try {
        const userRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('users');
        const snapshot = await userRef.limit(50).get();

        list.innerHTML = '';
        snapshot.forEach(doc => {
            const u = doc.data();
            if (u.role === 'admin') return; 

            const item = `
                <div class="flex justify-between items-center bg-white p-3 rounded-lg shadow-sm">
                    <div>
                        <div class="font-bold text-gray-800">${u.username}</div>
                        <div class="text-xs text-gray-500">Pass: ${u.password}</div>
                    </div>
                    <button onclick="deleteUser('${doc.id}')" class="bg-red-100 text-red-600 p-2 rounded hover:bg-red-200">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            list.innerHTML += item;
        });

        if (list.innerHTML === '') list.innerHTML = '<p class="text-center text-gray-400">Tidak ada user lain.</p>';

    } catch (e) {
        list.innerText = "Error loading users.";
    }
}

async function deleteUser(uid) {
    if(!confirm("Hapus user ini? Data tidak bisa kembali.")) return;
    try {
        await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('users').doc(uid).delete();
        loadUserList();
    } catch(e) {
        alert("Gagal menghapus: " + e.message);
    }
}

// Initial Start with DOM Ready check
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
});
