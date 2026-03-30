/* ============================================
   PROCWATCH OS v3.0 — app.js
   Real Device Data Engine
   Uses: navigator.deviceMemory, hardwareConcurrency,
         Battery API, Network Information API,
         performance.memory, requestAnimationFrame FPS,
         scheduler timing for CPU load estimation
   ============================================ */
'use strict';

// ─── REAL DEVICE DATA STORE ───────────────────
const DEVICE = {
  cores: navigator.hardwareConcurrency || 4,
  ram: navigator.deviceMemory || 4,        // GB (rounded by browser: 0.25–8)
  platform: '',
  os: '',
  browser: '',
  screen: '',
  dpr: window.devicePixelRatio || 1,
  touch: navigator.maxTouchPoints || 0,
  lang: navigator.language || 'en',
  online: navigator.onLine,
  battery: null,
  connection: navigator.connection || navigator.mozConnection || navigator.webkitConnection || null,
};

// ─── MEASURED METRICS (updated every tick) ───
const METRICS = {
  cpuLoad: 0,
  fps: 60,
  heapUsed: 0,
  heapTotal: 0,
  heapLimit: 0,
  heapPct: 0,
  batPct: 0,
  batCharging: false,
  batTime: 0,
  netType: '--',
  netEff: '--',
  netDl: '--',
  netRtt: '--',
  netPing: '--',
};

// ─── HISTORY BUFFERS ─────────────────────────
const HIST = 60;
const cpuHist  = new Array(HIST).fill(0);
const heapHist = new Array(HIST).fill(0);
const fpsHist  = new Array(HIST).fill(60);
const cpuSpark = new Array(30).fill(0);
const memSpark = new Array(30).fill(0);
const batSpark = new Array(30).fill(0);

let uptime = 0;
let tickCount = 0;
let selectedPids = new Set();
let filterState  = 'all';
let searchQuery  = '';
let sortKey      = 'cpu';
let processes    = [];
let pidCounter   = 400;
let alertCount   = 0;

// ─── FPS MEASUREMENT ─────────────────────────
let lastFrameTime = performance.now();
let frameCount = 0;
let measuredFps = 60;
function measureFps() {
  frameCount++;
  const now = performance.now();
  if (now - lastFrameTime >= 1000) {
    measuredFps = Math.round(frameCount * 1000 / (now - lastFrameTime));
    frameCount = 0;
    lastFrameTime = now;
  }
  requestAnimationFrame(measureFps);
}
requestAnimationFrame(measureFps);

// ─── CPU LOAD via SCHEDULER TIMING ───────────────
// Technique: if JS event loop is busy, setTimeout fires late
// We measure actual vs expected delay to estimate load
let cpuLoadEstimate = 0;
let lastCpuCheck = Date.now();
function measureCpuLoad() {
  const expected = 100;
  const start = Date.now();
  setTimeout(() => {
    const actual = Date.now() - start;
    const delay = actual - expected;
    // Normalize: >200ms delay = ~100% load
    const load = Math.min(100, Math.max(0, (delay / 200) * 100));
    // Smooth with previous
    cpuLoadEstimate = cpuLoadEstimate * 0.7 + load * 0.3;
    // Also factor in heap usage as a proxy
    if (window.performance && performance.memory) {
      const heapPct = performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit * 100;
      cpuLoadEstimate = cpuLoadEstimate * 0.6 + heapPct * 0.4;
    }
    measureCpuLoad();
  }, expected);
}
measureCpuLoad();

// ─── PERMISSION SCREEN ───────────────────────
document.getElementById('perm-allow-btn').addEventListener('click', () => {
  document.getElementById('permission-screen').style.opacity = '0';
  document.getElementById('permission-screen').style.transition = 'opacity .5s';
  setTimeout(() => {
    document.getElementById('permission-screen').style.display = 'none';
    document.getElementById('boot-screen').style.display = 'flex';
    runBoot();
  }, 500);
});

// ─── DETECT OS ───────────────────────────────
function detectOS() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua))      return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Windows NT 10/i.test(ua)) return 'Windows 10/11';
  if (/Windows NT 6.3/i.test(ua)) return 'Windows 8.1';
  if (/Windows/i.test(ua))       return 'Windows';
  if (/Mac OS X/i.test(ua))      return 'macOS';
  if (/Linux/i.test(ua))         return 'Linux';
  if (/CrOS/i.test(ua))          return 'ChromeOS';
  return navigator.platform || 'Unknown';
}

function detectBrowser() {
  const ua = navigator.userAgent;
  if (/Edg\//i.test(ua))     return 'Edge';
  if (/OPR\//i.test(ua))     return 'Opera';
  if (/Chrome\//i.test(ua))  return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua))  return 'Safari';
  return 'Browser';
}

function detectPlatformShort() {
  const os = detectOS();
  if (os.includes('Android')) return 'ANDROID';
  if (os.includes('iOS'))     return 'iOS';
  if (os.includes('Windows')) return 'WINDOWS';
  if (os.includes('macOS'))   return 'MACOS';
  if (os.includes('Linux'))   return 'LINUX';
  if (os.includes('Chrome'))  return 'CHROMEOS';
  return 'UNKNOWN';
}

// ─── BOOT SEQUENCE ───────────────────────────
function runBoot() {
  DEVICE.os      = detectOS();
  DEVICE.browser = detectBrowser();
  DEVICE.platform= detectPlatformShort();
  DEVICE.screen  = screen.width + '×' + screen.height;

  const lines = [
    '[    0.000000] PROCWATCH OS Kernel interface init...',
    `[    0.012345] Detected OS: ${DEVICE.os}`,
    `[    0.023456] CPU Logical Cores: ${DEVICE.cores} (real from navigator.hardwareConcurrency)`,
    `[    0.034567] Device RAM: ${DEVICE.ram} GB (real from navigator.deviceMemory)`,
    `[    0.045678] Screen Resolution: ${DEVICE.screen} @ ${DEVICE.dpr}x DPR`,
    `[    0.056789] Touch Points: ${DEVICE.touch} | Language: ${DEVICE.lang}`,
    `[    0.067890] Browser: ${DEVICE.browser} | Online: ${navigator.onLine}`,
    '[    0.078901] Requesting Battery Status API...',
    '[    0.089012] Probing Network Information API...',
    '[    0.100000] Starting FPS measurement via requestAnimationFrame...',
    '[    0.111111] Starting CPU load estimator via scheduler timing...',
    '[    0.122222] Building OS-specific process table...',
    '[    0.133333] Mounting virtual /proc filesystem...',
    '[    0.144444] All systems nominal — launching dashboard...',
  ];

  const log = document.getElementById('boot-log');
  const bar = document.getElementById('boot-bar');
  let i = 0;
  const step = () => {
    if (i < lines.length) {
      const d = document.createElement('div');
      d.textContent = lines[i];
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
      bar.style.width = ((i + 1) / lines.length * 100) + '%';
      bar.style.transition = 'width .15s';
      i++;
      setTimeout(step, 130 + Math.random() * 80);
    } else {
      setTimeout(launchApp, 600);
    }
  };
  step();
}

function launchApp() {
  document.getElementById('boot-screen').style.opacity = '0';
  document.getElementById('boot-screen').style.transition = 'opacity .5s';
  setTimeout(() => {
    document.getElementById('boot-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    init();
  }, 500);
}

// ─── INIT ───────────────────────────────────
async function init() {
  populateStaticDeviceInfo();
  await initBattery();
  initNetwork();
  buildProcesses();
  setupControls();
  setupClock();
  buildCpuCores();
  populateNavDump();
  tick();
  setInterval(tick, 1500);
  log('info', '⚡', `ProcWatch started on ${DEVICE.os} — ${DEVICE.cores} cores, ${DEVICE.ram}GB RAM`);
  log('info', '📡', `Network: ${METRICS.netType} (${METRICS.netEff})`);
  log('info', '🔧', `Browser: ${DEVICE.browser} | Screen: ${DEVICE.screen}`);
}

function populateStaticDeviceInfo() {
  // Topbar
  document.getElementById('top-platform').textContent = DEVICE.platform;
  document.getElementById('top-cores').textContent    = DEVICE.cores + ' cores';
  document.getElementById('top-ram').textContent      = DEVICE.ram + ' GB';
  document.getElementById('top-browser').textContent  = DEVICE.browser;

  // Device card
  document.getElementById('dev-os').textContent     = DEVICE.os;
  document.getElementById('dev-screen').textContent = DEVICE.screen;
  document.getElementById('dev-dpr').textContent    = DEVICE.dpr + 'x';
  document.getElementById('dev-touch').textContent  = DEVICE.touch + ' pts';
  document.getElementById('dev-cores').textContent  = DEVICE.cores;
  document.getElementById('dev-lang').textContent   = DEVICE.lang;

  // Concept card
  document.getElementById('concept-real-info').textContent =
    `${DEVICE.cores} cores · ${DEVICE.ram}GB RAM · ${DEVICE.os}`;

  // Proc label
  document.getElementById('proc-os-label').textContent = DEVICE.os;

  // Mem total display
  document.getElementById('mem-total-disp').textContent = DEVICE.ram + ' GB';

  // Cores real count
  document.getElementById('cores-real-count').textContent = DEVICE.cores;

  // Page load time
  if (window.performance && performance.timing) {
    const load = performance.timing.loadEventEnd - performance.timing.navigationStart;
    if (load > 0) document.getElementById('page-load').textContent = load + ' ms';
  }

  // perf entries
  if (window.performance && performance.getEntriesByType) {
    document.getElementById('perf-entries') && (document.getElementById('perf-entries').textContent =
      performance.getEntriesByType('resource').length + ' res');
  }
}

// ─── BATTERY API ─────────────────────────────
async function initBattery() {
  if (!navigator.getBattery) {
    document.getElementById('bat-pct').textContent    = 'N/A';
    document.getElementById('bat-detail').textContent = 'Not supported';
    METRICS.batPct = 0;
    log('warn', '🔋', 'Battery API not supported on this device/browser');
    return;
  }
  try {
    const bat = await navigator.getBattery();
    DEVICE.battery = bat;
    const update = () => {
      METRICS.batPct      = Math.round(bat.level * 100);
      METRICS.batCharging = bat.charging;
      METRICS.batTime     = bat.charging ? bat.chargingTime : bat.dischargingTime;
      const timeStr = isFinite(METRICS.batTime) && METRICS.batTime > 0
        ? Math.round(METRICS.batTime / 60) + ' min'
        : (bat.charging ? 'Charging' : 'Full');
      document.getElementById('bat-pct').textContent    = METRICS.batPct + '%';
      document.getElementById('bat-detail').textContent =
        (bat.charging ? '⚡ Charging' : '🔋 Discharging') + ' · ' + timeStr;
      setRing('ring-bat', METRICS.batPct);
      push(batSpark, METRICS.batPct);
    };
    update();
    bat.addEventListener('chargingchange',    update);
    bat.addEventListener('levelchange',       update);
    bat.addEventListener('chargingtimechange',update);
    bat.addEventListener('dischargingtimechange', update);
    log('info', '🔋', `Battery: ${METRICS.batPct}% (${METRICS.batCharging ? 'Charging' : 'Discharging'})`);
  } catch(e) {
    document.getElementById('bat-pct').textContent    = 'N/A';
    document.getElementById('bat-detail').textContent = 'Permission denied';
    log('warn', '🔋', 'Battery API permission denied');
  }
}

// ─── NETWORK INFO API ────────────────────────
function initNetwork() {
  const conn = DEVICE.connection;
  const update = () => {
    METRICS.netType = conn ? (conn.type || '--') : (navigator.onLine ? 'Online' : 'Offline');
    METRICS.netEff  = conn ? (conn.effectiveType || '--') : '--';
    METRICS.netDl   = conn ? (conn.downlink ? conn.downlink + ' Mbps' : '--') : '--';
    METRICS.netRtt  = conn ? (conn.rtt ? conn.rtt + ' ms' : '--') : '--';
    document.getElementById('net-type').textContent   = METRICS.netType;
    document.getElementById('net-eff').textContent    = METRICS.netEff;
    document.getElementById('net-dl').textContent     = METRICS.netDl;
    document.getElementById('net-rtt').textContent    = METRICS.netRtt;
    document.getElementById('net-online').textContent = navigator.onLine ? '✓ Online' : '✗ Offline';
    document.getElementById('top-net').textContent    = METRICS.netEff || (navigator.onLine ? 'Online' : 'Offline');
    measurePing();
  };
  update();
  if (conn) conn.addEventListener('change', update);
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
}

function measurePing() {
  const t0 = performance.now();
  fetch('https://www.google.com/favicon.ico?t=' + Date.now(), {mode:'no-cors', cache:'no-store'})
    .then(() => {
      const ping = Math.round(performance.now() - t0);
      METRICS.netPing = ping + ' ms';
      document.getElementById('net-ping').textContent = ping + ' ms';
    })
    .catch(() => {
      METRICS.netPing = '--';
      document.getElementById('net-ping').textContent = '--';
    });
}

// ─── PROCESS TABLE GENERATION ───────────────
// OS-specific process sets based on detected OS
const PROC_SETS = {
  Linux: [
    {base:'systemd',ppid:0,user:'root',type:'system',nice:0,prio:20,threads:1,cmd:'/usr/lib/systemd/systemd'},
    {base:'kthreadd',ppid:0,user:'root',type:'kernel',nice:-20,prio:0,threads:1,cmd:'[kthreadd]'},
    {base:'rcu_gp',ppid:2,user:'root',type:'kernel',nice:-20,prio:0,threads:1,cmd:'[rcu_gp]'},
    {base:'kswapd0',ppid:2,user:'root',type:'kernel',nice:0,prio:20,threads:1,cmd:'[kswapd0]'},
    {base:'kworker/u',ppid:2,user:'root',type:'kernel',nice:-20,prio:0,threads:1,cmd:'[kworker/u8:0]'},
    {base:'ksoftirqd',ppid:2,user:'root',type:'kernel',nice:0,prio:20,threads:1,cmd:'[ksoftirqd/0]'},
    {base:'jbd2',ppid:2,user:'root',type:'kernel',nice:-20,prio:0,threads:1,cmd:'[jbd2/sda1-8]'},
    {base:'sshd',ppid:1,user:'root',type:'daemon',nice:0,prio:20,threads:1,cmd:'/usr/sbin/sshd -D'},
    {base:'cron',ppid:1,user:'root',type:'daemon',nice:0,prio:20,threads:1,cmd:'/usr/sbin/cron -f'},
    {base:'dbus-daemon',ppid:1,user:'messagebus',type:'daemon',nice:0,prio:20,threads:1,cmd:'dbus-daemon --system'},
    {base:'NetworkManager',ppid:1,user:'root',type:'daemon',nice:0,prio:20,threads:3,cmd:'/usr/sbin/NetworkManager'},
    {base:'rsyslogd',ppid:1,user:'syslog',type:'daemon',nice:0,prio:20,threads:4,cmd:'/usr/sbin/rsyslogd'},
    {base:'gnome-shell',ppid:1,user:'user',type:'user',nice:0,prio:20,threads:12,cmd:'/usr/bin/gnome-shell'},
    {base:'bash',ppid:1,user:'user',type:'user',nice:0,prio:20,threads:1,cmd:'-bash'},
    {base:'firefox',ppid:1,user:'user',type:'user',nice:0,prio:20,threads:40,cmd:'/usr/lib/firefox/firefox'},
    {base:'code',ppid:1,user:'user',type:'user',nice:0,prio:20,threads:24,cmd:'/usr/share/code/code'},
    {base:'python3',ppid:1,user:'user',type:'user',nice:0,prio:20,threads:2,cmd:'python3 main.py'},
    {base:'gcc',ppid:1,user:'user',type:'user',nice:0,prio:20,threads:1,cmd:'gcc -o app main.c'},
    {base:'containerd',ppid:1,user:'root',type:'daemon',nice:0,prio:20,threads:20,cmd:'/usr/bin/containerd'},
  ],
  Windows: [
    {base:'System',ppid:0,user:'SYSTEM',type:'kernel',nice:-20,prio:0,threads:144,cmd:'System'},
    {base:'smss.exe',ppid:4,user:'SYSTEM',type:'kernel',nice:0,prio:11,threads:2,cmd:'\\SystemRoot\\System32\\smss.exe'},
    {base:'csrss.exe',ppid:0,user:'SYSTEM',type:'system',nice:0,prio:13,threads:10,cmd:'%SystemRoot%\\system32\\csrss.exe'},
    {base:'wininit.exe',ppid:0,user:'SYSTEM',type:'system',nice:0,prio:13,threads:1,cmd:'wininit.exe'},
    {base:'services.exe',ppid:0,user:'SYSTEM',type:'system',nice:0,prio:9,threads:8,cmd:'C:\\Windows\\system32\\services.exe'},
    {base:'lsass.exe',ppid:0,user:'SYSTEM',type:'system',nice:0,prio:9,threads:8,cmd:'C:\\Windows\\system32\\lsass.exe'},
    {base:'svchost.exe',ppid:4,user:'SYSTEM',type:'daemon',nice:0,prio:8,threads:30,cmd:'C:\\Windows\\system32\\svchost.exe -k DcomLaunch'},
    {base:'svchost.exe',ppid:4,user:'NETWORK SERVICE',type:'daemon',nice:0,prio:8,threads:14,cmd:'C:\\Windows\\system32\\svchost.exe -k NetworkService'},
    {base:'dwm.exe',ppid:0,user:'DWM-1',type:'system',nice:0,prio:13,threads:12,cmd:'dwm.exe'},
    {base:'explorer.exe',ppid:0,user:'user',type:'user',nice:0,prio:8,threads:60,cmd:'C:\\Windows\\Explorer.EXE'},
    {base:'chrome.exe',ppid:0,user:'user',type:'user',nice:0,prio:8,threads:55,cmd:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'},
    {base:'msedge.exe',ppid:0,user:'user',type:'user',nice:0,prio:8,threads:48,cmd:'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'},
    {base:'Code.exe',ppid:0,user:'user',type:'user',nice:0,prio:8,threads:30,cmd:'C:\\Users\\user\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'},
    {base:'python.exe',ppid:0,user:'user',type:'user',nice:0,prio:8,threads:3,cmd:'python main.py'},
    {base:'WindowsTerminal',ppid:0,user:'user',type:'user',nice:0,prio:8,threads:15,cmd:'WindowsTerminal.exe'},
    {base:'SearchIndexer',ppid:4,user:'SYSTEM',type:'daemon',nice:0,prio:6,threads:14,cmd:'C:\\Windows\\system32\\SearchIndexer.exe'},
    {base:'WmiPrvSE.exe',ppid:4,user:'NETWORK SERVICE',type:'daemon',nice:0,prio:8,threads:12,cmd:'C:\\Windows\\system32\\wbem\\wmiprvse.exe'},
    {base:'spoolsv.exe',ppid:4,user:'SYSTEM',type:'daemon',nice:0,prio:8,threads:12,cmd:'C:\\Windows\\System32\\spoolsv.exe'},
    {base:'MsMpEng.exe',ppid:4,user:'SYSTEM',type:'daemon',nice:0,prio:8,threads:40,cmd:'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\MsMpEng.exe'},
    {base:'Taskmgr.exe',ppid:0,user:'user',type:'user',nice:0,prio:13,threads:8,cmd:'C:\\Windows\\system32\\Taskmgr.exe'},
  ],
  macOS: [
    {base:'launchd',ppid:0,user:'root',type:'system',nice:0,prio:31,threads:4,cmd:'/sbin/launchd'},
    {base:'kernel_task',ppid:0,user:'root',type:'kernel',nice:-20,prio:0,threads:256,cmd:'kernel_task'},
    {base:'syslogd',ppid:1,user:'root',type:'daemon',nice:0,prio:31,threads:3,cmd:'/usr/sbin/syslogd'},
    {base:'configd',ppid:1,user:'root',type:'daemon',nice:0,prio:31,threads:6,cmd:'/usr/libexec/configd'},
    {base:'mDNSResponder',ppid:1,user:'_mdnsresponder',type:'daemon',nice:0,prio:31,threads:3,cmd:'/usr/sbin/mDNSResponder'},
    {base:'diskarbitrationd',ppid:1,user:'root',type:'daemon',nice:0,prio:31,threads:3,cmd:'/usr/sbin/diskarbitrationd'},
    {base:'WindowServer',ppid:1,user:'_windowserver',type:'system',nice:0,prio:79,threads:10,cmd:'/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer'},
    {base:'Finder',ppid:1,user:'user',type:'user',nice:0,prio:31,threads:6,cmd:'/System/Library/CoreServices/Finder.app'},
    {base:'Safari',ppid:1,user:'user',type:'user',nice:0,prio:31,threads:30,cmd:'/Applications/Safari.app/Contents/MacOS/Safari'},
    {base:'Xcode',ppid:1,user:'user',type:'user',nice:0,prio:31,threads:20,cmd:'/Applications/Xcode.app/Contents/MacOS/Xcode'},
    {base:'Terminal',ppid:1,user:'user',type:'user',nice:0,prio:31,threads:5,cmd:'/Applications/Utilities/Terminal.app'},
    {base:'Python',ppid:1,user:'user',type:'user',nice:0,prio:31,threads:2,cmd:'python3 main.py'},
    {base:'sharingd',ppid:1,user:'root',type:'daemon',nice:0,prio:31,threads:5,cmd:'/usr/libexec/sharingd'},
    {base:'bluetoothd',ppid:1,user:'root',type:'daemon',nice:0,prio:31,threads:3,cmd:'/usr/sbin/bluetoothd'},
    {base:'airportd',ppid:1,user:'root',type:'daemon',nice:0,prio:31,threads:4,cmd:'/usr/libexec/airportd'},
  ],
  Android: [
    {base:'init',ppid:0,user:'root',type:'system',nice:0,prio:20,threads:1,cmd:'/init'},
    {base:'kthreadd',ppid:0,user:'root',type:'kernel',nice:-20,prio:0,threads:1,cmd:'[kthreadd]'},
    {base:'zygote64',ppid:1,user:'root',type:'system',nice:-20,prio:0,threads:10,cmd:'zygote64'},
    {base:'system_server',ppid:0,user:'system',type:'system',nice:-2,prio:18,threads:130,cmd:'system_server'},
    {base:'surfaceflinger',ppid:1,user:'system',type:'daemon',nice:-8,prio:12,threads:24,cmd:'/system/bin/surfaceflinger'},
    {base:'servicemanager',ppid:1,user:'system',type:'daemon',nice:0,prio:20,threads:1,cmd:'/system/bin/servicemanager'},
    {base:'vold',ppid:1,user:'root',type:'daemon',nice:0,prio:20,threads:4,cmd:'/system/bin/vold'},
    {base:'netd',ppid:1,user:'root',type:'daemon',nice:0,prio:20,threads:8,cmd:'/system/bin/netd'},
    {base:'com.android.phone',ppid:0,user:'radio',type:'user',nice:0,prio:20,threads:40,cmd:'com.android.phone'},
    {base:'com.android.launcher3',ppid:0,user:'user',type:'user',nice:0,prio:20,threads:30,cmd:'com.android.launcher3'},
    {base:'com.google.android.gms',ppid:0,user:'system',type:'daemon',nice:-1,prio:19,threads:80,cmd:'com.google.android.gms'},
    {base:'chrome_zygote',ppid:0,user:'user',type:'user',nice:0,prio:20,threads:10,cmd:'chrome_zygote'},
    {base:'kswapd0',ppid:2,user:'root',type:'kernel',nice:0,prio:20,threads:1,cmd:'[kswapd0]'},
    {base:'thermal-engine',ppid:1,user:'root',type:'daemon',nice:0,prio:20,threads:4,cmd:'/system/bin/thermal-engine'},
  ],
  iOS: [
    {base:'launchd',ppid:0,user:'root',type:'system',nice:0,prio:31,threads:4,cmd:'/sbin/launchd'},
    {base:'kernel_task',ppid:0,user:'root',type:'kernel',nice:-20,prio:0,threads:200,cmd:'kernel_task'},
    {base:'SpringBoard',ppid:1,user:'mobile',type:'system',nice:0,prio:46,threads:15,cmd:'/System/Library/CoreServices/SpringBoard.app'},
    {base:'backboardd',ppid:1,user:'root',type:'daemon',nice:0,prio:61,threads:8,cmd:'/usr/libexec/backboardd'},
    {base:'configd',ppid:1,user:'root',type:'daemon',nice:0,prio:31,threads:5,cmd:'/usr/libexec/configd'},
    {base:'locationd',ppid:1,user:'_locationd',type:'daemon',nice:0,prio:31,threads:8,cmd:'/usr/libexec/locationd'},
    {base:'MobileSafari',ppid:1,user:'mobile',type:'user',nice:0,prio:31,threads:20,cmd:'MobileSafari'},
    {base:'MobilePhone',ppid:1,user:'mobile',type:'user',nice:0,prio:31,threads:10,cmd:'MobilePhone'},
    {base:'mDNSResponder',ppid:1,user:'_mdnsresponder',type:'daemon',nice:0,prio:31,threads:3,cmd:'/usr/sbin/mDNSResponder'},
  ],
};

// Generic fallback
PROC_SETS.Unknown = PROC_SETS.Linux;
PROC_SETS['Windows 10/11'] = PROC_SETS.Windows;
PROC_SETS['Windows 8.1']   = PROC_SETS.Windows;
PROC_SETS.ChromeOS         = PROC_SETS.Linux;

function buildProcesses() {
  processes = [];
  const os    = DEVICE.os;
  const set   = PROC_SETS[os] || PROC_SETS.Linux;
  const cores = DEVICE.cores;

  // Fixed PID 1 or 4 based on OS
  const basePid = os.includes('Windows') ? 4 : 1;
  let pid = basePid;

  set.forEach(p => {
    processes.push({
      pid: pid++,
      ppid: p.ppid,
      name: p.base,
      state: pickState(p.type),
      type: p.type,
      user: p.user,
      cpu: p.type === 'kernel' ? rnd(0, 0.5) : (p.type === 'daemon' ? rnd(0, 3) : rnd(0.5, 12)),
      mem: p.type === 'kernel' ? rnd(0, 0.2) : (p.type === 'daemon' ? rnd(0.1, 2) : rnd(0.5, 5)),
      rss: 0,
      threads: p.threads,
      priority: p.prio,
      nice: p.nice,
      started: startTime(),
      cmd: p.cmd,
      age: 0,
      cpuHistory: new Array(10).fill(0),
    });
    pid++;
  });

  // Add kernel cores based on real core count
  for (let i = 0; i < Math.min(cores, 8); i++) {
    const name = os.includes('Windows') ? 'System' : `[kworker/${i}:1]`;
    processes.push({
      pid: pid++, ppid: os.includes('Windows') ? 4 : 2,
      name, state: 'I', type: 'kernel',
      user: 'root', cpu: rnd(0, 0.3), mem: rnd(0, 0.1), rss: 0,
      threads: 1, priority: os.includes('Windows') ? 8 : 0, nice: -20,
      started: startTime(), cmd: name, age: 0,
      cpuHistory: new Array(10).fill(0),
    });
  }

  // Add orphans and zombies
  addSpecialProcs();
  // Update RSS based on mem%
  processes.forEach(p => { p.rss = Math.floor(p.mem * DEVICE.ram * 1024 * 10); });
  pidCounter = pid;
  log('info', '⚙', `Loaded ${processes.length} processes for ${DEVICE.os}`);
}

function addSpecialProcs() {
  // 2 zombies
  ['defunct_worker','dead_helper'].forEach(n => {
    processes.push({
      pid:pidCounter++,ppid:1,name:n,state:'Z',type:'zombie',
      user:'user',cpu:0,mem:0,rss:0,threads:0,priority:20,nice:0,
      started:startTime(),cmd:'['+n+'] <defunct>',age:0,cpuHistory:new Array(10).fill(0)
    });
  });
  // 2 orphans
  ['orphan_proc','reparented_task'].forEach(n => {
    processes.push({
      pid:pidCounter++,ppid:1,name:n,state:'S',type:'orphan',
      user:'user',cpu:rnd(0,1),mem:rnd(0.1,0.5),rss:rnd(512,2048),
      threads:1,priority:20,nice:0,
      started:startTime(),cmd:'/usr/bin/'+n,age:0,cpuHistory:new Array(10).fill(0)
    });
  });
}

function pickState(type) {
  if (type==='zombie')  return 'Z';
  if (type==='kernel')  return Math.random()<.7?'I':'S';
  if (type==='daemon')  return Math.random()<.8?'S':'R';
  const r=Math.random();
  if (r<.15) return 'R';
  if (r<.8)  return 'S';
  if (r<.9)  return 'D';
  return 'T';
}
function startTime(){const d=new Date(Date.now()-Math.random()*7200000);return d.toTimeString().slice(0,8)}
function rnd(a,b){return +(Math.random()*(b-a)+a).toFixed(2)}

// ─── MAIN TICK ───────────────────────────────
function tick() {
  tickCount++;
  uptime++;
  updateMetrics();
  updateProcesses();
  renderAll();
}

function updateMetrics() {
  // CPU from our estimator
  METRICS.cpuLoad = Math.min(100, Math.max(2, cpuLoadEstimate + rnd(-5, 5)));

  // FPS
  METRICS.fps = measuredFps;

  // JS Heap (Chrome only)
  if (window.performance && performance.memory) {
    METRICS.heapUsed  = performance.memory.usedJSHeapSize;
    METRICS.heapTotal = performance.memory.totalJSHeapSize;
    METRICS.heapLimit = performance.memory.jsHeapSizeLimit;
    METRICS.heapPct   = Math.round(METRICS.heapUsed / METRICS.heapLimit * 100);
  } else {
    // Estimate
    METRICS.heapPct = Math.min(80, Math.max(5, METRICS.heapPct + rnd(-2, 2)));
  }

  // Memory estimate from real RAM size + CPU load proxy
  const memEstPct = Math.min(90, 30 + (METRICS.cpuLoad * 0.3) + rnd(-3, 3));

  // Push histories
  push(cpuHist,  METRICS.cpuLoad);
  push(heapHist, METRICS.heapPct);
  push(fpsHist,  Math.min(METRICS.fps, 60) / 60 * 100);
  push(cpuSpark, METRICS.cpuLoad);
  push(memSpark, memEstPct);

  // Network: re-probe every 20 ticks
  if (tickCount % 20 === 0) measurePing();
  // Re-read connection
  const conn = DEVICE.connection;
  if (conn) {
    document.getElementById('net-type').textContent = conn.type || '--';
    document.getElementById('net-eff').textContent  = conn.effectiveType || '--';
    document.getElementById('net-dl').textContent   = conn.downlink ? conn.downlink + ' Mbps' : '--';
    document.getElementById('net-rtt').textContent  = conn.rtt ? conn.rtt + ' ms' : '--';
  }
}

function updateProcesses() {
  processes.forEach(p => {
    if (p.state==='Z') return;
    // Scale CPU fluctuation to real measured load
    const loadFactor = METRICS.cpuLoad / 100;
    p.cpu = clamp(p.cpu + (Math.random()-.5)*3 + loadFactor*.5, 0, p.type==='kernel'?.8:p.type==='user'?30:8);
    p.mem = clamp(p.mem + (Math.random()-.5)*.2, 0, p.type==='user'?8:3);
    p.rss = Math.floor(p.mem * DEVICE.ram * 1024 * 8);
    if (p.type!=='zombie'&&p.type!=='kernel'&&Math.random()<.025) p.state=stateTransition(p.state);
    push(p.cpuHistory, p.cpu);
  });
  if (tickCount%10===0&&Math.random()<.3) spawnTemp();
  if (tickCount%12===0) {
    const temps=processes.filter(p=>p.isTemp&&p.age>5);
    if (temps.length) {
      const t=temps[Math.floor(Math.random()*temps.length)];
      if (Math.random()<.25) {
        t.state='Z';t.type='zombie';t.cpu=0;t.mem=0;t.cmd='['+t.name+'] <defunct>';
        log('warn','🧟',`[${t.name}] PID ${t.pid} → ZOMBIE`);alertCount++;
      } else {
        processes=processes.filter(p=>p!==t);
        log('info','✓',`[${t.name}] PID ${t.pid} exited`);
      }
    }
  }
  processes=processes.filter(p=>!(p.state==='Z'&&p.age>20));
  processes.forEach(p=>p.age++);
  if (tickCount%15===0) checkAlerts();
}

function stateTransition(s){const m={R:'S',S:'R',D:'S',T:'S'};return m[s]||s}

function spawnTemp() {
  const isWin = DEVICE.os.includes('Windows');
  const names = isWin
    ? ['msiexec.exe','conhost.exe','cmd.exe','powershell.exe','notepad.exe','tasklist.exe']
    : ['stress-ng','wget','curl','git','npm','pip3','make','gcc','bash','python3'];
  const n=names[Math.floor(Math.random()*names.length)];
  processes.push({
    pid:pidCounter++,ppid:isWin?4:1,name:n,state:'R',type:'user',
    user:isWin?'user':'user',
    cpu:rnd(5,35),mem:rnd(.3,2),rss:rnd(1024,8192),
    threads:Math.ceil(Math.random()*4),priority:20,nice:0,
    started:new Date().toTimeString().slice(0,8),
    cmd:(isWin?'C:\\Windows\\system32\\':'/usr/bin/')+n+' --verbose',
    age:0,cpuHistory:new Array(10).fill(0),isTemp:true
  });
  log('info','🚀',`New process: [${n}] PID ${pidCounter-1}`);
}

function checkAlerts() {
  if (METRICS.cpuLoad>80){log('warn','⚠️',`High CPU: ${METRICS.cpuLoad.toFixed(1)}%`);alertCount++;}
  const z=processes.filter(p=>p.state==='Z').length;
  if (z>2){log('error','🧟',`${z} zombie processes!`);alertCount++;}
  document.getElementById('alert-badge')&&updateAlertBadge();
}
function updateAlertBadge() {
  // No alert-badge in this version, we use real-badge
}

// ─── RENDER ─────────────────────────────────
function renderAll() {
  renderTopBar();
  renderRings();
  renderPerfCard();
  renderSparklines();
  renderHistoryChart();
  renderDonut();
  renderTopCpuChart();
  renderProcessTable();
  renderConceptStats();
  renderMemMap();
  renderCpuCores();
  renderUptime();
  document.getElementById('footer-update').textContent = 'Updated: ' + new Date().toTimeString().slice(0,8);
}

function renderTopBar() {
  document.getElementById('top-platform').textContent = DEVICE.platform;
}

function renderRings() {
  const memEstPct = Math.min(90, 30 + (METRICS.cpuLoad * 0.3));
  setRing('ring-cpu', METRICS.cpuLoad);
  setRing('ring-mem', memEstPct);
  document.getElementById('cpu-pct').textContent = Math.round(METRICS.cpuLoad) + '%';
  document.getElementById('mem-pct').textContent = Math.round(memEstPct) + '%';
  document.getElementById('cpu-detail').textContent = DEVICE.cores + ' cores @ ' + detectBrowser();
  document.getElementById('mem-used-disp').textContent = (DEVICE.ram * memEstPct / 100).toFixed(1) + ' GB';
}

const CIRCUM = 2 * Math.PI * 32;
function setRing(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  const fill = (pct / 100) * CIRCUM;
  el.setAttribute('stroke-dasharray', fill + ' ' + Math.max(0, CIRCUM - fill));
}

function renderPerfCard() {
  const mb = 1048576;
  document.getElementById('heap-used').textContent  = METRICS.heapUsed  ? fmtBytes(METRICS.heapUsed)  : '--';
  document.getElementById('heap-total').textContent = METRICS.heapTotal ? fmtBytes(METRICS.heapTotal) : '--';
  document.getElementById('heap-limit').textContent = METRICS.heapLimit ? fmtBytes(METRICS.heapLimit) : '--';
  document.getElementById('heap-pct').textContent   = METRICS.heapPct ? METRICS.heapPct + '%' : '--';
  document.getElementById('fps-val').textContent    = METRICS.fps + ' fps';
}

function fmtBytes(b) {
  if (b >= 1073741824) return (b/1073741824).toFixed(1)+' GB';
  if (b >= 1048576)    return (b/1048576).toFixed(0)+' MB';
  return (b/1024).toFixed(0)+' KB';
}

function renderSparklines() {
  drawSpark('cpu-spark', cpuSpark, '#00ffcc');
  drawSpark('mem-spark', memSpark, '#ff6b35');
  drawSpark('bat-spark', batSpark, '#6bcb77');
}

function drawSpark(id, data, color) {
  const c = document.getElementById(id);
  if (!c) return;
  const ctx = c.getContext('2d'), W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  const max = Math.max(...data, 1);
  ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  data.forEach((v, i) => {
    const x = (i / (data.length-1)) * W, y = H - (v/max)*H*.85;
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  });
  ctx.stroke();
  ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
  ctx.fillStyle = color + '20'; ctx.fill();
}

function renderHistoryChart() {
  const canvas = document.getElementById('history-chart');
  if (!canvas) return;
  const W = canvas.parentElement.offsetWidth - 24;
  if (W > 0) canvas.width = W;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#1e2d4540'; ctx.lineWidth = 1;
  for (let i=0;i<=4;i++){const y=H*i/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();ctx.fillStyle='#4a5568';ctx.font='9px JetBrains Mono';ctx.fillText((100-i*25)+'%',2,y+9)}
  drawLine(ctx, W, H, cpuHist,  '#00ffcc', 2);
  drawLine(ctx, W, H, heapHist, '#ff6b35', 1.5);
  drawLine(ctx, W, H, fpsHist,  '#ffd93d', 1.5);
}

function drawLine(ctx, W, H, data, color, lw) {
  ctx.beginPath(); ctx.strokeStyle=color; ctx.lineWidth=lw;
  ctx.shadowColor=color; ctx.shadowBlur=4;
  data.forEach((v,i)=>{const x=(i/(data.length-1))*W,y=H-(v/100)*H*.9-2;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});
  ctx.stroke(); ctx.shadowBlur=0;
}

const STATE_COLORS = {R:'#6bcb77',S:'#4fc3f7',D:'#ffd93d',Z:'#ff4757',T:'#a55eea',I:'#4a5568'};
const STATE_LABELS = {R:'Running',S:'Sleeping',D:'DiskWait',Z:'Zombie',T:'Stopped',I:'Idle'};

function renderDonut() {
  const canvas = document.getElementById('state-donut');
  if (!canvas) return;
  const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H);
  const counts={};
  Object.keys(STATE_COLORS).forEach(k=>counts[k]=0);
  processes.forEach(p=>{if(counts[p.state]!==undefined)counts[p.state]++});
  const total=processes.length||1;
  const cx=W/2,cy=H/2;
  let angle=-Math.PI/2;
  const legend=document.getElementById('donut-legend');
  legend.innerHTML='';
  Object.entries(STATE_COLORS).forEach(([k,color])=>{
    const n=counts[k];if(!n)return;
    const sweep=(n/total)*2*Math.PI;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,70,angle,angle+sweep);ctx.closePath();
    ctx.fillStyle=color;ctx.fill();angle+=sweep;
    const li=document.createElement('div');li.className='dl-item';
    li.innerHTML=`<span class="dl-dot" style="background:${color}"></span>${k}: ${n}`;
    legend.appendChild(li);
  });
  ctx.beginPath();ctx.arc(cx,cy,42,0,2*Math.PI);ctx.fillStyle='#111827';ctx.fill();
  ctx.fillStyle='#e2e8f0';ctx.font='bold 13px Orbitron';ctx.textAlign='center';ctx.fillText(processes.length,cx,cy+4);
  ctx.font='8px JetBrains Mono';ctx.fillStyle='#8898aa';ctx.fillText('PROCS',cx,cy+16);
}

function renderTopCpuChart() {
  const canvas=document.getElementById('top-cpu-chart');if(!canvas)return;
  const W=canvas.parentElement.offsetWidth-24;if(W>0)canvas.width=W;
  const H=canvas.height,ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  const top=[...processes].sort((a,b)=>b.cpu-a.cpu).slice(0,6);
  const maxC=top[0]?.cpu||1,barH=Math.floor(H/top.length)-4;
  top.forEach((p,i)=>{
    const y=i*(barH+4)+2,bw=(p.cpu/Math.max(maxC,10))*(W-90);
    const grad=ctx.createLinearGradient(60,0,60+bw,0);
    grad.addColorStop(0,p.cpu>20?'#ff4757':p.cpu>10?'#ffd93d':'#00ffcc');
    grad.addColorStop(1,'#ffffff15');
    ctx.fillStyle=grad;ctx.fillRect(60,y,bw,barH);
    ctx.fillStyle='#e2e8f0';ctx.font='9px JetBrains Mono';ctx.textAlign='right';
    ctx.fillText(p.name.slice(0,10),56,y+barH-3);
    ctx.textAlign='left';ctx.fillStyle='#8898aa';
    ctx.fillText(p.cpu.toFixed(1)+'%',64+bw+3,y+barH-3);
  });
}

function renderProcessTable() {
  let list=[...processes];
  if(filterState!=='all') list=list.filter(p=>{
    if(filterState==='running')  return p.state==='R';
    if(filterState==='sleeping') return p.state==='S'||p.state==='I';
    if(filterState==='zombie')   return p.state==='Z'||p.type==='zombie';
    if(filterState==='orphan')   return p.type==='orphan';
    if(filterState==='daemon')   return p.type==='daemon';
    if(filterState==='kernel')   return p.type==='kernel';
    if(filterState==='user')     return p.type==='user';
    return true;
  });
  if(searchQuery){const q=searchQuery.toLowerCase();list=list.filter(p=>p.name.toLowerCase().includes(q)||String(p.pid).includes(q)||p.user.toLowerCase().includes(q)||p.cmd.toLowerCase().includes(q))}
  list.sort((a,b)=>sortKey==='cpu'?b.cpu-a.cpu:sortKey==='mem'?b.mem-a.mem:sortKey==='pid'?a.pid-b.pid:a.name.localeCompare(b.name));
  const tbody=document.getElementById('proc-tbody');
  const rows=list.map(p=>{
    const cpuClass=p.cpu>20?'high-cpu':p.cpu>5?'med-cpu':'low-cpu';
    const sel=selectedPids.has(p.pid)?' selected':'';
    return `<tr class="proc-row${sel}" data-pid="${p.pid}">
      <td><input type="checkbox" class="row-chk" data-pid="${p.pid}"${sel?' checked':''}></td>
      <td class="pid-val">${p.pid}</td><td class="user-val">${p.ppid}</td>
      <td class="name-val">${esc(p.name)}</td>
      <td><span class="state-badge state-${p.state}">${p.state} ${STATE_LABELS[p.state]||''}</span></td>
      <td><span class="type-badge type-${p.type}">${p.type.toUpperCase()}</span></td>
      <td class="user-val">${p.user}</td>
      <td><div class="mini-bar-wrap"><div class="mini-bar"><div class="mini-fill fill-cpu" style="width:${Math.min(p.cpu/30*100,100)}%"></div></div><span class="cpu-val ${cpuClass}">${p.cpu.toFixed(1)}%</span></div></td>
      <td><div class="mini-bar-wrap"><div class="mini-bar"><div class="mini-fill fill-mem" style="width:${Math.min(p.mem/8*100,100)}%"></div></div><span>${p.mem.toFixed(1)}%</span></div></td>
      <td>${fmtRss(p.rss)}</td><td>${p.threads}</td><td>${p.priority}</td><td>${p.nice}</td>
      <td>${p.started}</td>
      <td class="cmd-val" title="${esc(p.cmd)}">${esc(p.cmd.slice(0,28))}${p.cmd.length>28?'…':''}</td>
      <td><button class="act-btn" onclick="showDetail(${p.pid})">INFO</button><button class="act-btn" onclick="killProc(${p.pid})">KILL</button><button class="act-btn nice-btn" onclick="renice(${p.pid})">NICE</button></td>
    </tr>`;
  });
  tbody.innerHTML=rows.join('');
  tbody.querySelectorAll('.row-chk').forEach(chk=>{
    chk.addEventListener('change',e=>{const pid=+e.target.dataset.pid;e.target.checked?selectedPids.add(pid):selectedPids.delete(pid);updateKillBtn()});
  });
}

function renderConceptStats() {
  document.getElementById('concept-zombie-count').textContent=processes.filter(p=>p.state==='Z').length+' detected';
  document.getElementById('concept-orphan-count').textContent=processes.filter(p=>p.type==='orphan').length+' detected';
  document.getElementById('concept-daemon-count').textContent=processes.filter(p=>p.type==='daemon').length+' detected';
  document.getElementById('concept-kernel-count').textContent=processes.filter(p=>p.type==='kernel').length+' detected';
}

function renderMemMap() {
  const totalGb=DEVICE.ram;
  const totalMb=totalGb*1024;
  const kernel=512,browser=METRICS.heapTotal?Math.round(METRICS.heapTotal/1048576):200;
  const apps=Math.round(totalMb*(METRICS.cpuLoad/100)*0.4);
  const cache=Math.round(totalMb*.1);
  const free=Math.max(0,totalMb-kernel-browser-apps-cache);
  const segs=[
    {label:`OS Kernel ${kernel}MB`,pct:kernel/totalMb*100,color:'#00ffcc'},
    {label:`Apps ~${apps}MB`,pct:apps/totalMb*100,color:'#ff6b35'},
    {label:`Browser/JS ~${browser}MB`,pct:browser/totalMb*100,color:'#ffd93d'},
    {label:`Cache ~${cache}MB`,pct:cache/totalMb*100,color:'#6bcb77'},
    {label:`Free ~${free}MB`,pct:free/totalMb*100,color:'#222c3f'},
  ];
  document.getElementById('mem-map-visual').innerHTML=segs.map(s=>`<div class="mem-seg" style="width:${Math.max(s.pct,0.5)}%;background:${s.color}" data-label="${s.label}"></div>`).join('');
  document.getElementById('mem-detail-rows').innerHTML=[
    {k:'Total RAM',v:totalGb+'GB (real)'},
    {k:'OS/Kernel',v:kernel+' MB'},
    {k:'Apps (est)',v:apps+' MB'},
    {k:'JS Heap',v:METRICS.heapUsed?fmtBytes(METRICS.heapUsed):'--'},
    {k:'Free (est)',v:fmtBytes(free*1024*1024)},
  ].map(r=>`<div class="mem-row"><span class="mem-row-k">${r.k}</span><span class="mem-row-v">${r.v}</span></div>`).join('');
}

function buildCpuCores() {
  const n = DEVICE.cores;
  const cols = n <= 4 ? n : n <= 8 ? 4 : 8;
  const grid = document.getElementById('cpu-cores-grid');
  grid.style.gridTemplateColumns = `repeat(${cols},1fr)`;
  grid.innerHTML = Array.from({length:n},(_,i)=>`<div class="core-item" id="core-${i}"><div class="core-label">CORE ${i}</div><div class="core-pct" id="cp-${i}">0%</div><div class="core-bar"><div class="core-fill" id="cf-${i}"></div></div></div>`).join('');
}

function renderCpuCores() {
  const base = METRICS.cpuLoad;
  for (let i=0;i<DEVICE.cores;i++) {
    // Vary each core around the overall measured load
    const v = clamp(base+(Math.random()-.5)*20, 2, 100);
    const pe=document.getElementById('cp-'+i),fe=document.getElementById('cf-'+i);
    if (!pe) continue;
    pe.textContent=v.toFixed(0)+'%';
    pe.style.color=v>80?'#ff4757':v>50?'#ffd93d':'#6bcb77';
    fe.style.width=v+'%';
    fe.style.background=v>80?'#ff4757':v>50?'#ffd93d':'#00ffcc';
  }
}

function populateNavDump() {
  const data = [
    ['navigator.cores',    DEVICE.cores],
    ['navigator.deviceMemory', DEVICE.ram + ' GB'],
    ['navigator.platform', navigator.platform],
    ['navigator.userAgent',navigator.userAgent.slice(0,60)+'…'],
    ['navigator.language', navigator.language],
    ['navigator.onLine',   navigator.onLine],
    ['navigator.maxTouchPoints', DEVICE.touch],
    ['navigator.cookieEnabled', navigator.cookieEnabled],
    ['screen.width',       screen.width],
    ['screen.height',      screen.height],
    ['screen.colorDepth',  screen.colorDepth],
    ['screen.pixelDepth',  screen.pixelDepth],
    ['window.devicePixelRatio', DEVICE.dpr],
    ['performance.now()',  Math.round(performance.now()) + ' ms'],
    ['connection.type',    DEVICE.connection?.type || 'N/A'],
    ['connection.effectiveType', DEVICE.connection?.effectiveType || 'N/A'],
    ['connection.downlink',DEVICE.connection?.downlink + ' Mbps' || 'N/A'],
    ['connection.rtt',     DEVICE.connection?.rtt + ' ms' || 'N/A'],
    ['Battery API',        navigator.getBattery ? 'Supported' : 'Not supported'],
    ['Detected OS',        DEVICE.os],
    ['Detected Browser',   DEVICE.browser],
  ];
  document.getElementById('nav-dump').innerHTML=data.map(([k,v])=>`<div class="nav-row"><span class="nav-k">${k}</span><span class="nav-v">${v}</span></div>`).join('');
}

// ─── ACTIONS ─────────────────────────────────
window.killProc=function(pid){
  const idx=processes.findIndex(p=>p.pid===pid);if(idx===-1)return;
  const p=processes[idx];
  if(p.pid<=10){toast('Cannot kill system process!','error');return}
  processes.splice(idx,1);
  log('error','⊗',`SIGKILL → [${p.name}] PID ${p.pid}`);
  toast(`[${p.name}] PID ${p.pid} killed`,'success');
};
window.renice=function(pid){
  const p=processes.find(p=>p.pid===pid);if(!p)return;
  const v=prompt(`Nice value for [${p.name}] PID ${p.pid} (-20 to 19):`,p.nice);
  if(v===null)return;
  const n=parseInt(v);
  if(isNaN(n)||n<-20||n>19){toast('Invalid nice value!','error');return}
  p.nice=n;p.priority=20+n;
  log('info','🔧',`renice [${p.name}] PID ${p.pid} → nice=${n}`);
  toast(`Reniced [${p.name}] to ${n}`,'info');
};
window.showDetail=function(pid){
  const p=processes.find(p=>p.pid===pid);if(!p)return;
  const html=`<div class="proc-detail">
    <div class="pd-row"><div class="pd-key">PID</div><div class="pd-val" style="color:#00ffcc">${p.pid}</div></div>
    <div class="pd-row"><div class="pd-key">PPID</div><div class="pd-val">${p.ppid}</div></div>
    <div class="pd-row"><div class="pd-key">Name</div><div class="pd-val">${p.name}</div></div>
    <div class="pd-row"><div class="pd-key">State</div><div class="pd-val" style="color:${STATE_COLORS[p.state]||'#fff'}">${p.state} — ${STATE_LABELS[p.state]||''}</div></div>
    <div class="pd-row"><div class="pd-key">Type</div><div class="pd-val">${p.type.toUpperCase()}</div></div>
    <div class="pd-row"><div class="pd-key">User</div><div class="pd-val">${p.user}</div></div>
    <div class="pd-row"><div class="pd-key">CPU %</div><div class="pd-val">${p.cpu.toFixed(2)}%</div></div>
    <div class="pd-row"><div class="pd-key">Mem %</div><div class="pd-val">${p.mem.toFixed(2)}%</div></div>
    <div class="pd-row"><div class="pd-key">RSS</div><div class="pd-val">${fmtRss(p.rss)}</div></div>
    <div class="pd-row"><div class="pd-key">Threads</div><div class="pd-val">${p.threads}</div></div>
    <div class="pd-row"><div class="pd-key">Priority</div><div class="pd-val">${p.priority}</div></div>
    <div class="pd-row"><div class="pd-key">Nice</div><div class="pd-val">${p.nice}</div></div>
    <div class="pd-row" style="grid-column:1/-1"><div class="pd-key">CMD</div><div class="pd-val" style="font-size:.62rem;word-break:break-all">${esc(p.cmd)}</div></div>
    <div class="pd-row" style="grid-column:1/-1"><div class="pd-key">OS CONCEPT</div><div class="pd-val" style="color:#ffd93d;font-size:.68rem">${getOSConcept(p)}</div></div>
  </div>`;
  showModal('📋 Process — '+p.name,null,null,html);
};

function getOSConcept(p){
  if(p.type==='zombie') return '🧟 ZOMBIE — Process ended but parent not called wait(). PCB still in process table. Occupies PID slot.';
  if(p.type==='orphan') return '👻 ORPHAN — Parent process exited. Re-parented to init (PID 1). Continues running normally.';
  if(p.type==='kernel') return '⚛️ KERNEL THREAD — Runs in kernel address space only. No user-space memory mapping.';
  if(p.type==='daemon') return '👾 DAEMON — Background service. No controlling terminal. Usually started at boot by init/systemd.';
  if(p.state==='R')     return '🟢 RUNNING — Currently using CPU or in run queue. Scheduler may give it a time slice next.';
  if(p.state==='S')     return '💤 SLEEPING (Interruptible) — Waiting for I/O or event. Can be woken by signal.';
  if(p.state==='D')     return '🔴 UNINTERRUPTIBLE SLEEP — Waiting for hardware I/O. Cannot be killed even by SIGKILL.';
  if(p.state==='T')     return '⏸ STOPPED — Paused by SIGSTOP. Can resume with SIGCONT.';
  return '📋 USER PROCESS — Normal user-space process. Scheduled by CFS (Completely Fair Scheduler).';
}

// ─── MODAL & LOG & TOAST ─────────────────────
function showModal(title,body,onConfirm,html){
  const o=document.createElement('div');o.className='modal-overlay';
  o.innerHTML=`<div class="modal"><h3>${title}</h3>${body?`<p>${body}</p>`:''}${html||''}<div class="modal-btns">${onConfirm?'<button class="btn-confirm">CONFIRM</button>':''}<button class="btn-cancel">CLOSE</button></div></div>`;
  document.body.appendChild(o);
  o.querySelector('.btn-cancel').addEventListener('click',()=>o.remove());
  if(onConfirm)o.querySelector('.btn-confirm').addEventListener('click',()=>{onConfirm();o.remove()});
  o.addEventListener('click',e=>{if(e.target===o)o.remove()});
}
const MAX_LOG=60;
function log(type,icon,msg){
  const el=document.getElementById('log-entries');if(!el)return;
  const e=document.createElement('div');e.className=`log-entry ${type}`;
  e.innerHTML=`<span class="log-time">${new Date().toTimeString().slice(0,8)}</span><span class="log-icon">${icon}</span><span class="log-msg">${msg}</span>`;
  el.insertBefore(e,el.firstChild);
  while(el.children.length>MAX_LOG)el.removeChild(el.lastChild);
}
function toast(msg,type='info'){
  const c=document.getElementById('toast-container');
  const t=document.createElement('div');t.className=`toast toast-${type}`;t.textContent=msg;
  c.appendChild(t);
  setTimeout(()=>{t.style.transition='opacity .4s';t.style.opacity='0';setTimeout(()=>t.remove(),400)},2500);
}

// ─── UTILS ───────────────────────────────────
function push(a,v){a.shift();a.push(v)}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v))}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function fmtRss(kb){if(kb>=1048576)return(kb/1048576).toFixed(1)+' GB';if(kb>=1024)return(kb/1024).toFixed(0)+' MB';return kb+' KB'}

// ─── CONTROLS ────────────────────────────────
function setupControls() {
  document.getElementById('filter-chips').addEventListener('click',e=>{
    if(!e.target.classList.contains('chip'))return;
    document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
    e.target.classList.add('active');filterState=e.target.dataset.filter;
  });
  document.getElementById('search-box').addEventListener('input',e=>searchQuery=e.target.value.trim());
  document.getElementById('sort-sel').addEventListener('change',e=>sortKey=e.target.value);
  document.getElementById('btn-kill').addEventListener('click',()=>{
    if(!selectedPids.size)return;
    const pids=[...selectedPids];
    showModal('⊗ Confirm Kill',`Send SIGKILL to ${pids.length} process(es)?`,()=>{pids.forEach(killProc);selectedPids.clear();updateKillBtn()});
  });
  document.getElementById('btn-refresh').addEventListener('click',()=>{tick();toast('Refreshed','info')});
  document.getElementById('btn-clear-log').addEventListener('click',()=>{document.getElementById('log-entries').innerHTML='';alertCount=0});
  document.getElementById('chk-all').addEventListener('change',e=>{
    document.querySelectorAll('.row-chk').forEach(chk=>{chk.checked=e.target.checked;const pid=+chk.dataset.pid;e.target.checked?selectedPids.add(pid):selectedPids.delete(pid)});updateKillBtn();
  });
}
function updateKillBtn(){document.getElementById('btn-kill').disabled=selectedPids.size===0}

// ─── CLOCK ───────────────────────────────────
function setupClock(){
  const u=()=>document.getElementById('clock-display').textContent=new Date().toTimeString().slice(0,8);
  u();setInterval(u,1000);
}
function renderUptime(){
  const h=String(Math.floor(uptime/3600)).padStart(2,'0');
  const m=String(Math.floor((uptime%3600)/60)).padStart(2,'0');
  const s=String(uptime%60).padStart(2,'0');
  document.getElementById('uptime-val').textContent=`${h}:${m}:${s}`;
}
