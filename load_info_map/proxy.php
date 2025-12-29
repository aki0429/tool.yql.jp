<?php
// Set the content type to GeoJSON, which is a specific type of JSON.
header('Content-Type: application/json');

// Define the base URL for the JARTIC API.
$baseUrl = 'https://api.jartic-open-traffic.org/geoserver';

// Check if all the necessary query parameters are provided.
if (isset($_GET['service']) && isset($_GET['version']) && isset($_GET['request']) && isset($_GET['typeNames']) && isset($_GET['outputFormat']) && isset($_GET['srsName']) && isset($_GET['cql_filter'])) {

    // Build the query string from the parameters sent by the JavaScript.
    $queryString = http_build_query($_GET);

    // Construct the full API URL.
    $apiUrl = $baseUrl . '?' . $queryString;

    // Initialize a cURL session. cURL is a library for transferring data with URLs.
    $ch = curl_init();

    // Set the cURL options.
    curl_setopt($ch, CURLOPT_URL, $apiUrl); // Set the URL to fetch.
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true); // Return the transfer as a string.
    curl_setopt($ch, CURLOPT_TIMEOUT, 10); // Set a 10-second timeout.
    curl_setopt($ch, CURLOPT_HEADER, false); // Don't include the header in the output.

    // Execute the cURL session and get the result.
    $response = curl_exec($ch);

    // Check for cURL errors.
    if (curl_errno($ch)) {
        // If there's an error, return a JSON error message.
        echo json_encode(['error' => 'cURL Error: ' . curl_error($ch)]);
    } else {
        // If successful, echo the response from the API.
        echo $response;
    }

    // Close the cURL session.
    curl_close($ch);

} else {
    // If required parameters are missing, return a JSON error message.
    http_response_code(400); // Set HTTP status code to 400 Bad Request.
    echo json_encode(['error' => 'Missing required query parameters.']);
}
?>