// シンプルな機能
document.addEventListener('DOMContentLoaded', function() {
    // 現在のページのリンクをハイライト
    const currentPath = window.location.pathname;
    const links = document.querySelectorAll('.vertical-nav a');
    
    links.forEach(link => {
        if (currentPath.startsWith(link.getAttribute('href'))) {
            link.style.backgroundColor = '#f0f0f0';
        }
    });
});
