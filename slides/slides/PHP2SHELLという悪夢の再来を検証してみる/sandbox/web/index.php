<?php
session_start();
header('Content-Type: application/json');

function value_or_null($array, $key)
{
    return isset($array[$key]) ? $array[$key] : null;
}

$files = array();
foreach ($_FILES as $key => $file) {
    $files[$key] = array(
        'name' => value_or_null($file, 'name'),
        'size' => value_or_null($file, 'size'),
        'error' => value_or_null($file, 'error'),
    );
}

$progress = isset($_SESSION['upload_progress_x']) ? $_SESSION['upload_progress_x'] : null;
if (is_array($progress)) {
    $progress_files = array();
    if (isset($progress['files']) && is_array($progress['files'])) {
        foreach ($progress['files'] as $file) {
            if (!is_array($file)) {
                continue;
            }
            $progress_files[] = array(
                'field_name' => value_or_null($file, 'field_name'),
                'name' => value_or_null($file, 'name'),
                'bytes_processed' => value_or_null($file, 'bytes_processed'),
                'error' => value_or_null($file, 'error'),
                'done' => value_or_null($file, 'done'),
            );
        }
    }
    $progress = array(
        'bytes_processed' => value_or_null($progress, 'bytes_processed'),
        'content_length' => value_or_null($progress, 'content_length'),
        'done' => value_or_null($progress, 'done'),
        'files' => $progress_files,
    );
}

echo json_encode(array(
    'php' => PHP_VERSION,
    'sapi' => PHP_SAPI,
    'session_id' => session_id(),
    'upload_progress' => $progress,
    'files' => $files,
    'post_keys' => array_keys($_POST),
), JSON_UNESCAPED_SLASHES), "\n";
