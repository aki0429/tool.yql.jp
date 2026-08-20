<?php
require_once __DIR__ . '/_jma_raw_proxy.php';
// VPTW60～VPTW69のうち、フィード上で最新の台風電文を返す。
jmaRawProxy('extra', 'VPTW6');
