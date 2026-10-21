<?php
$file = isset($_GET['file']) ? $_GET['file'] : '';
if ($file !== '') {
    include($file);
}
