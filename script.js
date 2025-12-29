const images = [
    'image/image.png',
    'image/image1.png',
    'image/image2.png',
    'image/image3.png',
    'image/image4.png',
];

const randomImage = images[Math.floor(Math.random() * images.length)];
document.body.style.backgroundImage = `url('${randomImage}')`;
document.body.style.backgroundSize = 'cover';
document.body.style.backgroundPosition = 'center';