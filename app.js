// ============================================
// SUPABASE RAG APPLICATION
// ============================================

// Check if config is valid BEFORE trying to create Supabase client
function isConfigValid() {
    if (typeof SUPABASE_CONFIG === 'undefined') return false;

    const isPlaceholderUrl = !SUPABASE_CONFIG.url ||
        SUPABASE_CONFIG.url.includes('YOUR_SUPABASE') ||
        SUPABASE_CONFIG.url.includes('YOUR-PROJECT') ||
        SUPABASE_CONFIG.url === 'https://your-project-ref.supabase.co' ||
        SUPABASE_CONFIG.url === 'https://YOUR_PROJECT_REF.supabase.co';

    const isPlaceholderKey = !SUPABASE_CONFIG.anonKey ||
        SUPABASE_CONFIG.anonKey.includes('YOUR_SUPABASE') ||
        SUPABASE_CONFIG.anonKey.includes('your-anon-key') ||
        SUPABASE_CONFIG.anonKey === 'YOUR_SUPABASE_ANON_KEY_HERE' ||
        SUPABASE_CONFIG.anonKey.length < 20;

    return !isPlaceholderUrl && !isPlaceholderKey;
}

// Initialize Supabase client only if config is valid
let supabaseClient = null;
let configIsValid = false;
let appInitialized = false;

function initializeSupabase() {
    configIsValid = isConfigValid();
    if (configIsValid && !supabaseClient) {
        try {
            supabaseClient = window.supabase.createClient(
                SUPABASE_CONFIG.url,
                SUPABASE_CONFIG.anonKey
            );
            // Listen for auth state changes
            supabaseClient.auth.onAuthStateChange((event, session) => {
                if (event === 'SIGNED_IN' && session) {
                    showApp(session.user);
                } else if (event === 'SIGNED_OUT') {
                    showLogin();
                }
            });
        } catch (err) {
            console.error('Failed to initialize Supabase client:', err);
        }
    }
}


// DOM Elements
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const emailInput = document.getElementById('email-input');
const loginBtn = document.getElementById('login-btn');
const loginMessage = document.getElementById('login-message');
const logoutBtn = document.getElementById('logout-btn');
const userEmailSpan = document.getElementById('user-email');
const loading = document.getElementById('loading');

// Setup Banner Elements
const setupBanner = document.getElementById('setup-banner');
const githubPagesUrl = document.getElementById('github-pages-url');
const copyUrlBtn = document.getElementById('copy-url-btn');
const closeSetupBannerBtn = document.getElementById('close-setup-banner');
const checkConfig = document.getElementById('check-config');
const checkConnection = document.getElementById('check-connection');
const checkRedirect = document.getElementById('check-redirect');

// Search Panel Elements
const keywordInput = document.getElementById('keyword-input');
const keywordBtn = document.getElementById('keyword-btn');
const keywordResults = document.getElementById('keyword-results');
const keywordStatus = document.getElementById('keyword-status');

const semanticInput = document.getElementById('semantic-input');
const semanticBtn = document.getElementById('semantic-btn');
const semanticResults = document.getElementById('semantic-results');
const semanticStatus = document.getElementById('semantic-status');

const ragInput = document.getElementById('rag-input');
const ragBtn = document.getElementById('rag-btn');
const ragResults = document.getElementById('rag-results');
const ragStatus = document.getElementById('rag-status');

// ============================================
// SETUP BANNER DETECTION
// ============================================

async function runSetupChecks() {
    const setupStatus = {
        configValid: false,
        connectionOk: false,
        allGood: false
    };

    // Calculate and display GitHub Pages URL (full URL with path)
    const currentUrl = window.location.origin + window.location.pathname;
    if (githubPagesUrl) {
        githubPagesUrl.textContent = currentUrl;
    }

    // Set setup guide link to GitHub repo (for better preview)
    const setupGuideLink = document.getElementById('setup-guide-link');
    if (setupGuideLink && currentUrl.includes('github.io')) {
        const pathParts = window.location.pathname.split('/').filter(p => p);
        const repoName = pathParts[0] || 'conference-rag';
        const username = currentUrl.split('.github.io')[0].split('//')[1];
        setupGuideLink.href = `https://github.com/${username}/${repoName}/blob/main/README.md`;
    } else if (setupGuideLink) {
        setupGuideLink.href = 'README.md';
    }

    // Set Supabase URL configuration link
    const supabaseConfigLink = document.getElementById('supabase-config-link');
    if (supabaseConfigLink && typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.url) {
        try {
            const supabaseUrl = new URL(SUPABASE_CONFIG.url);
            const projectId = supabaseUrl.hostname.split('.')[0];
            supabaseConfigLink.href = `https://supabase.com/dashboard/project/${projectId}/auth/url-configuration`;
        } catch (err) {
            supabaseConfigLink.style.display = 'none';
        }
    } else if (supabaseConfigLink) {
        supabaseConfigLink.style.display = 'none';
    }

    // Check 1: Config has real values
    if (!configIsValid) {
        updateCheckItem(checkConfig, 'error', '❌', 'Configure Supabase credentials in config.js');
        updateCheckItem(checkConnection, 'warning', '⏳', 'Waiting for config...');
    } else {
        updateCheckItem(checkConfig, 'success', '✅', 'Supabase credentials configured');
        setupStatus.configValid = true;

        // Check 2: Supabase connection
        if (supabaseClient) {
            try {
                const { data, error } = await supabaseClient.auth.getSession();
                if (error) {
                    updateCheckItem(checkConnection, 'error', '❌', `Connection failed: ${error.message}`);
                } else {
                    updateCheckItem(checkConnection, 'success', '✅', 'Supabase connection OK');
                    setupStatus.connectionOk = true;
                }
            } catch (err) {
                updateCheckItem(checkConnection, 'error', '❌', 'Connection failed - check config');
            }
        } else {
            updateCheckItem(checkConnection, 'error', '❌', 'Failed to create Supabase client');
        }
    }

    // Check 3: Redirect URL reminder
    updateCheckItem(checkRedirect, 'warning', '⚠️', `Add ${currentUrl} to Supabase redirect URLs`);

    // Show/hide banner
    setupStatus.allGood = setupStatus.configValid && setupStatus.connectionOk;
    const bannerDismissed = sessionStorage.getItem('setup_banner_dismissed');
    if (setupBanner) {
        if (!setupStatus.allGood && !bannerDismissed) {
            setupBanner.classList.remove('hidden');
        } else {
            setupBanner.classList.add('hidden');
        }
    }

    return setupStatus;
}

function updateCheckItem(element, status, icon, text) {
    if (!element) return;
    element.className = `setup-item ${status}`;
    const iconSpan = element.querySelector('.check-icon');
    const textSpan = element.querySelector('span:last-child');
    if (iconSpan) iconSpan.textContent = icon;
    if (textSpan) textSpan.textContent = text;
}

// Copy URL to clipboard
if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', async () => {
        const url = githubPagesUrl ? githubPagesUrl.textContent : (window.location.origin + window.location.pathname);
        try {
            await navigator.clipboard.writeText(url);
            copyUrlBtn.textContent = '✅';
            copyUrlBtn.classList.add('copied');
            setTimeout(() => {
                copyUrlBtn.textContent = '📋';
                copyUrlBtn.classList.remove('copied');
            }, 2000);
        } catch (err) {
            console.error('Failed to copy URL:', err);
        }
    });
}

// Dismiss setup banner
if (closeSetupBannerBtn) {
    closeSetupBannerBtn.addEventListener('click', () => {
        if (setupBanner) {
            setupBanner.classList.add('hidden');
        }
        sessionStorage.setItem('setup_banner_dismissed', 'true');
    });
}

// ============================================
// AUTHENTICATION
// ============================================

async function checkSession() {
    if (!supabaseClient) {
        showLogin();
        return;
    }

    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session) {
        showApp(session.user);
    } else {
        showLogin();
    }
}

// Handle magic link login
if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
        if (!supabaseClient) {
            showMessage('Please configure Supabase first (see Setup Guide)', 'error');
            return;
        }

        const email = emailInput.value.trim();

        if (!email) {
            showMessage('Please enter your email', 'error');
            return;
        }

        showLoading(true);

        const { error } = await supabaseClient.auth.signInWithOtp({
            email: email,
            options: {
                emailRedirectTo: window.location.origin + window.location.pathname
            }
        });

        showLoading(false);

        if (error) {
            showMessage(`Error: ${error.message}`, 'error');
        } else {
            showMessage('Check your email for the magic link!', 'success');
        }
    });
}

// Handle logout
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        if (supabaseClient) {
            await supabaseClient.auth.signOut();
        }
        showLogin();
    });
}

// Auth state change listener is now set up inside initializeSupabase()

// ============================================
// UI STATE MANAGEMENT
// ============================================

function showLogin() {
    if (loginScreen) loginScreen.classList.remove('hidden');
    if (appScreen) appScreen.classList.add('hidden');
}

function showApp(user) {
    if (loginScreen) loginScreen.classList.add('hidden');
    if (appScreen) appScreen.classList.remove('hidden');
    if (userEmailSpan) userEmailSpan.textContent = user.email;
    // Check search readiness when user logs in
    checkSearchReadiness();
}

function showMessage(text, type) {
    if (loginMessage) {
        loginMessage.textContent = text;
        loginMessage.className = `message ${type}`;
        loginMessage.classList.remove('hidden');
    }
}

function showLoading(show) {
    if (loading) {
        if (show) {
            loading.classList.remove('hidden');
        } else {
            loading.classList.add('hidden');
        }
    }
}

// ============================================
// SEARCH READINESS DETECTION
// ============================================

// Guard against double execution (checkSession + onAuthStateChange both call showApp)
let readinessCheckRunning = false;

async function checkSearchReadiness() {
    if (!supabaseClient || readinessCheckRunning) return;
    readinessCheckRunning = true;

    try {
        // --- Check 1: Any data at all? (keyword search just needs text) ---
        const { count: totalCount, error: totalError } = await supabaseClient
            .from('sentence_embeddings')
            .select('*', { count: 'exact', head: true });

        const hasData = !totalError && totalCount > 0;
        setSearchReady('keyword', hasData);

        // --- Check 2: Data with embeddings? (semantic search needs vectors) ---
        let hasEmbeddings = false;
        if (hasData) {
            const { count, error } = await supabaseClient
                .from('sentence_embeddings')
                .select('*', { count: 'exact', head: true })
                .not('embedding', 'is', null);
            hasEmbeddings = !error && count > 0;
        }

        // --- 1 embed-question call (only if DB has embeddings) ---
        let semanticReady = false;
        if (hasEmbeddings) {
            try {
                const { data, error: fnError } = await supabaseClient.functions.invoke('embed-question', {
                    body: { question: 'test' }
                });
                semanticReady = !fnError;
            } catch {
                // CORS or network error → function not deployed
            }
        }
        setSearchReady('semantic', semanticReady);

        // --- 1 generate-answer call (only if semantic pipeline is ready) ---
        if (!semanticReady) {
            setSearchReady('rag', false);
        } else {
            try {
                const { data, error: fnError } = await supabaseClient.functions.invoke('generate-answer', {
                    body: { question: 'test', context_talks: [] }
                });
                setSearchReady('rag', !fnError || fnError.context?.status !== 404);
            } catch {
                setSearchReady('rag', false);
            }
        }
    } catch (err) {
        console.log('Readiness check failed:', err.message);
        setSearchReady('keyword', false);
        setSearchReady('semantic', false);
        setSearchReady('rag', false);
    } finally {
        readinessCheckRunning = false;
    }
}

function setSearchReady(type, ready) {
    const statusEl = document.getElementById(`${type}-status`);
    const inputEl = document.getElementById(`${type}-input`);
    const btnEl = document.getElementById(`${type}-btn`);
    const panelEl = document.getElementById(`${type}-panel`);

    if (statusEl) {
        if (ready) {
            statusEl.textContent = '🟢 Ready';
            statusEl.className = 'status-badge ready';
        } else {
            statusEl.textContent = '🔴 Not Ready';
            statusEl.className = 'status-badge not-ready';
        }
    }

    if (inputEl) inputEl.disabled = !ready;
    if (btnEl) btnEl.disabled = !ready;

    if (panelEl) {
        if (ready) {
            panelEl.classList.add('panel-ready');
            panelEl.classList.remove('panel-not-ready');
        } else {
            panelEl.classList.add('panel-not-ready');
            panelEl.classList.remove('panel-ready');
        }
    }
}

// ============================================
// KEYWORD SEARCH
// ============================================

const sourceCheckboxes = [...document.querySelectorAll('input[name="source-type"]')];
let sourceSelectionVersion = 0;
const sourceLabels = { conference: 'Conference talks', scripture: 'Scriptures', pmg: 'Preach My Gospel' };

function selectedSources() {
    const sources = sourceCheckboxes.filter(input => input.checked).map(input => input.value);
    if (!sources.length) throw new Error('Choose at least one collection to search.');
    return sources;
}

function sourceDescription(record) {
    const type = record.source_type || 'conference';
    const label = sourceLabels[type] || type;
    const detail = type === 'conference' ? record.speaker : record.source_metadata?.headings?.join(' › ');
    return detail ? `${label} · ${detail}` : label;
}

for (const input of sourceCheckboxes) {
    input.addEventListener('change', () => {
        sourceSelectionVersion++;
        for (const mode of ['keyword', 'semantic', 'rag']) showResults(mode, '');
        const message = document.getElementById('source-filter-message');
        if (message) message.textContent = sourceCheckboxes.some(input => input.checked)
            ? '' : 'Choose at least one collection to search.';
    });
}

async function keywordSearch() {
    const query = keywordInput ? keywordInput.value.trim() : '';
    if (!query || !supabaseClient) return;

    showLoading(true);
    clearResults('keyword');
    const version = sourceSelectionVersion;

    try {
        const sources = selectedSources();
        // Search sentence_embeddings that contain the keyword (case-insensitive)
        const { data, error } = await supabaseClient
            .from('sentence_embeddings')
            .select('id, text, talk_id, title, speaker, url, source_type, source_metadata')
            .in('source_type', sources)
            .ilike('text', `%${query}%`)
            .limit(20);

        if (version !== sourceSelectionVersion) return;
        if (error) throw new Error(`Search failed: ${error.message}`);

        if (!data || data.length === 0) {
            showResults('keyword', '<div class="no-results">No results found. Try different keywords.</div>');
            return;
        }

        // Group by talk
        const talks = {};
        for (const row of data) {
            const talkId = row.source_type === 'conference' ? row.talk_id : row.id;
            if (!talks[talkId]) {
                talks[talkId] = {
                    title: row.title || 'Unknown Talk',
                    speaker: row.speaker || 'Unknown Speaker',
                    url: row.url || '',
                    source_type: row.source_type,
                    source_metadata: row.source_metadata,
                    sentences: []
                };
            }
            talks[talkId].sentences.push(highlightKeyword(row.text, query));
        }

        let html = '';
        for (const talk of Object.values(talks)) {
            html += `<div class="result-card">
                <div class="result-title"><a href="${escapeHtml(talk.url)}" target="_blank" class="result-title-link">${escapeHtml(talk.title)}</a></div>
                <div class="result-speaker">${escapeHtml(sourceDescription(talk))}</div>
                <div class="result-sentences">${talk.sentences.slice(0, 3).join('<br>')}</div>
            </div>`;
        }
        showResults('keyword', html);

    } catch (error) {
        if (version !== sourceSelectionVersion) return;
        showResults('keyword', `<div class="result-error">Error: ${escapeHtml(error.message)}</div>`);
    } finally {
        showLoading(false);
    }
}

function highlightKeyword(text, keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return escapeHtml(text).replace(regex, '<mark>$1</mark>');
}

// ============================================
// SEMANTIC SEARCH
// ============================================

async function semanticSearch() {
    const query = semanticInput ? semanticInput.value.trim() : '';
    if (!query || !supabaseClient) return;

    showLoading(true);
    clearResults('semantic');
    const version = sourceSelectionVersion;

    try {
        const sources = selectedSources();
        // Step 1: Get embedding
        const embedding = await getEmbedding(query);

        // Step 2: Search for similar sentences
        if (version !== sourceSelectionVersion) return;
        const results = await searchSentences(embedding, sources);
        if (version !== sourceSelectionVersion) return;

        if (!results || results.length === 0) {
            showResults('semantic', '<div class="no-results">No similar content found. Try a different query.</div>');
            return;
        }

        // Step 3: Display results with similarity badges
        let html = '';
        for (const result of results) {
            const sim = result.similarity;
            const badge = similarityBadge(sim);
            html += `<div class="result-card">
                <div class="result-card-header">
                    <div>
                        <div class="result-title"><a href="${escapeHtml(result.url)}" target="_blank" class="result-title-link">${escapeHtml(result.title)}</a></div>
                        <div class="result-speaker">${escapeHtml(sourceDescription(result))}</div>
                    </div>
                    ${badge}
                </div>
                <div class="result-sentences">${escapeHtml(result.text)}</div>
            </div>`;
        }
        showResults('semantic', html);

    } catch (error) {
        if (version !== sourceSelectionVersion) return;
        showResults('semantic', `<div class="result-error">Error: ${escapeHtml(error.message)}</div>`);
    } finally {
        showLoading(false);
    }
}

// ============================================
// RAG (ASK A QUESTION)
// ============================================

async function askQuestion() {
    const question = ragInput ? ragInput.value.trim() : '';
    if (!question || !supabaseClient) return;

    showLoading(true);
    clearResults('rag');
    const version = sourceSelectionVersion;

    try {
        const sources = selectedSources();
        // Step 1: Get embedding
        const embedding = await getEmbedding(question);

        // Step 2: Search for similar sentences
        if (version !== sourceSelectionVersion) return;
        const results = await searchSentences(embedding, sources);
        if (version !== sourceSelectionVersion) return;
        if (!results?.length) {
            showResults('rag', '<div class="no-results">No matching passages in the selected collections.</div>');
            return;
        }

        // Step 3: Group by talk (with similarity scores and URLs)
        const topTalks = groupByTalk(results);

        // Step 4: Fetch full talk text for richer context
        const enrichedTalks = await fetchFullTalkText(topTalks);
        if (version !== sourceSelectionVersion) return;

        // Step 5: Generate answer with full context
        const answer = await generateAnswer(question, enrichedTalks);
        if (version !== sourceSelectionVersion) return;

        // Compute overall similarity (weighted avg across source talks)
        const overallSimilarity = topTalks.reduce((sum, t) => sum + t.avgSimilarity, 0) / topTalks.length;
        const overallBadge = similarityBadge(overallSimilarity);
        const simClass = overallSimilarity >= 0.70 ? 'similarity-high'
            : overallSimilarity >= 0.40 ? 'similarity-mid' : 'similarity-low';

        let html = `<div class="result-card rag-answer rag-${simClass}">
            <div class="result-card-header">
                <div class="result-title">AI Answer</div>
                ${overallBadge}
            </div>
            <div class="result-sentences">${escapeHtml(answer)}</div>
        </div>`;

        // Show source talks with per-talk similarity badges and links
        html += '<div class="result-sources"><strong>Sources:</strong></div>';
        for (const talk of topTalks) {
            const talkBadge = similarityBadge(talk.avgSimilarity);
            html += `<div class="result-card result-source">
                <div class="result-card-header">
                    <div>
                        <div class="result-title"><a href="${escapeHtml(talk.url)}" target="_blank" class="result-title-link">${escapeHtml(talk.title)}</a></div>
                        <div class="result-speaker">${escapeHtml(sourceDescription(talk))}</div>
                    </div>
                    ${talkBadge}
                </div>
            </div>`;
        }
        showResults('rag', html);

    } catch (error) {
        if (version !== sourceSelectionVersion) return;
        showResults('rag', `<div class="result-error">Error: ${escapeHtml(error.message)}</div>`);
    } finally {
        showLoading(false);
    }
}

// ============================================
// SHARED SEARCH UTILITIES
// ============================================

// Get embedding via Edge Function
async function getEmbedding(text) {
    const { data, error } = await supabaseClient.functions.invoke('embed-question', {
        body: { question: text }
    });

    if (error) {
        throw new Error(data?.error || 'Failed to get embedding');
    }

    return data.embedding;
}

// Search sentences using vector similarity
async function searchSentences(embedding, sources = selectedSources()) {
    if (!supabaseClient) throw new Error('Supabase not configured');

    const { data, error } = await supabaseClient.rpc('match_library_sentences', {
        query_embedding: embedding,
        source_types: sources,
        match_count: 20
    });

    if (error) throw new Error(`Database search failed: ${error.message}`);
    return data;
}

// Group search results by talk, computing average similarity per talk
function groupByTalk(sentences) {
    const talkMap = {};

    for (const sent of sentences) {
        // Keep scripture references and PMG sections distinct; only group conference sentences.
        const key = sent.source_type === 'conference' || !sent.source_type ? sent.talk_id : sent.id;
        if (!talkMap[key]) {
            talkMap[key] = {
                talk_id: sent.talk_id,
                title: sent.title,
                speaker: sent.speaker,
                url: sent.url,
                source_type: sent.source_type || 'conference',
                source_metadata: sent.source_metadata || {},
                sentences: [],
                totalSimilarity: 0
            };
        }
        talkMap[key].sentences.push(sent.text);
        talkMap[key].totalSimilarity += sent.similarity;
    }

    return Object.values(talkMap)
        .sort((a, b) => b.totalSimilarity / b.sentences.length - a.totalSimilarity / a.sentences.length)
        .slice(0, 3)
        .map(talk => ({
            talk_id: talk.talk_id,
            title: talk.title,
            speaker: talk.speaker,
            url: talk.url,
            source_type: talk.source_type,
            source_metadata: talk.source_metadata,
            text: talk.sentences.join(' '),
            // TODO: Is average similarity the right metric? Alternatives worth researching:
            // - Max similarity (best single match per talk)
            // - Average of top-3 sentences (reduces noise from weak matches)
            // - Weighted by sentence count (rewards talks with more matches)
            avgSimilarity: talk.totalSimilarity / talk.sentences.length
        }));
}

// Fetch full talk text by querying all sentences for given talk_ids, ordered by sentence_num.
// Uses a single batched query via .in() for all talk_ids — no parallel calls needed.
async function fetchFullTalkText(talks) {
    if (!supabaseClient || !talks.length) return talks;

    // Library chunks already contain a bounded passage and its heading/reference.
    const talkIds = talks.filter(t => t.source_type === 'conference' || !t.source_type).map(t => t.talk_id);
    if (!talkIds.length) return talks;

    const { data, error } = await supabaseClient
        .from('sentence_embeddings')
        .select('talk_id, sentence_num, text')
        .eq('source_type', 'conference')
        .in('talk_id', talkIds)
        .order('talk_id')
        .order('sentence_num');

    if (error || !data) {
        console.warn('Failed to fetch full talk text, using snippets:', error?.message);
        return talks;
    }

    // Group fetched sentences by talk_id
    const fullTextMap = {};
    for (const row of data) {
        if (!fullTextMap[row.talk_id]) fullTextMap[row.talk_id] = [];
        fullTextMap[row.talk_id].push(row.text);
    }

    // Replace snippet text with full talk text
    return talks.map(talk => ({
        ...talk,
        text: (talk.source_type === 'conference' || !talk.source_type) && fullTextMap[talk.talk_id]
            ? fullTextMap[talk.talk_id].join(' ')
            : talk.text
    }));
}

// Generate answer via Edge Function
async function generateAnswer(question, contextTalks) {
    const { data, error } = await supabaseClient.functions.invoke('generate-answer', {
        body: {
            question: question,
            context_talks: contextTalks
        }
    });

    if (error) {
        throw new Error(data?.error || 'Failed to generate answer');
    }

    return data.answer;
}

// ============================================
// RESULTS DISPLAY HELPERS
// ============================================

function showResults(type, html) {
    const el = document.getElementById(`${type}-results`);
    if (el) el.innerHTML = html;
}

function clearResults(type) {
    const el = document.getElementById(`${type}-results`);
    if (el) el.innerHTML = '<div class="searching">Searching...</div>';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Similarity badge with color coding
function similarityBadge(similarity) {
    const pct = (similarity * 100).toFixed(0);
    let cls;
    if (similarity >= 0.70) {
        cls = 'similarity-high';
    } else if (similarity >= 0.40) {
        cls = 'similarity-mid';
    } else {
        cls = 'similarity-low';
    }
    return `<span class="similarity-badge ${cls}">${pct}%</span>`;
}

// ============================================
// EVENT LISTENERS
// ============================================

// Keyword search
if (keywordBtn) keywordBtn.addEventListener('click', keywordSearch);
if (keywordInput) keywordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') keywordSearch();
});

// Semantic search
if (semanticBtn) semanticBtn.addEventListener('click', semanticSearch);
if (semanticInput) semanticInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') semanticSearch();
});

// RAG search
if (ragBtn) ragBtn.addEventListener('click', askQuestion);
if (ragInput) ragInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') askQuestion();
});

// ============================================
// DEPLOY TIMESTAMP
// ============================================

function fetchDeployTimestamp() {
    const deployDateEl = document.getElementById('deploy-date');
    if (!deployDateEl) return;

    fetch(window.location.href, { method: 'HEAD' })
        .then(r => {
            const lastModified = r.headers.get('Last-Modified');
            if (lastModified) {
                const date = new Date(lastModified);
                deployDateEl.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
            } else {
                deployDateEl.textContent = 'unknown';
            }
        })
        .catch(() => {
            deployDateEl.textContent = 'unknown';
        });
}

// ============================================
// PAGE VIEW COUNTER
// ============================================
// Demonstrates public RLS policies: this works without authentication
// because page_views has anon INSERT + SELECT policies.

function recordPageView() {
    if (!supabaseClient) return;

    const pageViewsEl = document.getElementById('page-views-count');

    // Insert a page view (best-effort, no auth required)
    supabaseClient
        .from('page_views')
        .insert({
            page_url: window.location.href,
            user_agent: navigator.userAgent
        })
        .then(() => {
            // Query the total count
            return supabaseClient
                .from('page_views')
                .select('*', { count: 'exact', head: true });
        })
        .then(({ count }) => {
            if (pageViewsEl && count != null) {
                pageViewsEl.textContent = count.toLocaleString();
            }
        })
        .catch(() => {
            // Silently fail — table might not exist yet
            if (pageViewsEl) pageViewsEl.textContent = '—';
        });
}

// ============================================
// INITIALIZE APP
// ============================================

function initializeApp() {
    if (appInitialized) return;

    initializeSupabase();

    // These always run (even without valid config)
    fetchDeployTimestamp();
    runSetupChecks();

    if (supabaseClient) {
        appInitialized = true;
        recordPageView();
        checkSession();
    }
}

// Try to initialize immediately (works if config.js has inline values)
initializeApp();

// Re-initialize when config.public.json finishes loading
window.addEventListener('config-loaded', () => {
    initializeApp();
});
