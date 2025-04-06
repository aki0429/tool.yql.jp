document.addEventListener('DOMContentLoaded', function() {
    const warningList = document.getElementById('warningList');

    function getWarningClass(warning) {
        if (warning.includes('特別警報')) return 'special';
        if (warning.includes('警報')) return 'warning';
        if (warning.includes('注意報')) return 'advisory';
        return '';
    }

    fetch('https://www.jma.go.jp/bosai/warning/data/warning/map.json')
        .then(response => response.json())
        .then(data => {
            data.forEach(region => {
                if (region.warnings && region.warnings.length > 0) {
                    const areaDiv = document.createElement('div');
                    areaDiv.className = 'area';
                    
                    const areaName = document.createElement('h2');
                    areaName.textContent = `${region.name || '地域名なし'}`;
                    areaDiv.appendChild(areaName);

                    const warningsList = document.createElement('ul');
                    region.warnings.forEach(warning => {
                        const li = document.createElement('li');
                        li.className = getWarningClass(warning);
                        li.textContent = warning;
                        warningsList.appendChild(li);
                    });
                    
                    areaDiv.appendChild(warningsList);
                    warningList.appendChild(areaDiv);
                }
            });
        })
        .catch(error => console.error('Error:', error));
});
