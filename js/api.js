// Backend API configuration
// When the backend serves this website, leave API_BASE empty.
// If you host the frontend separately, set it to your backend URL.
window.API_BASE = window.API_BASE || "";

window.apiFetch = async function (path, options = {}) {
    const headers = options.headers ? {...options.headers} : {};
    const token = localStorage.getItem("adminToken");
    if (token) headers["X-Admin-Token"] = token;
    if (!(options.body instanceof FormData) && options.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }
    const response = await fetch(window.API_BASE + path, {...options, headers});
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
        const message = data?.error || `HTTP ${response.status}`;
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }
    return data;
};
