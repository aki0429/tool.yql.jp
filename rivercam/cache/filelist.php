<?php
header('Content-Type: application/json');
$files = glob("*.json");
echo json_encode($files);
