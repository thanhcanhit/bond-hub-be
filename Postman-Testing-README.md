# BondHub API Testing with Postman

This folder contains Postman collection and environment files for testing the BondHub API, specifically focusing on the user and friend modules.

## Files

- `BondHub-API-Tests.postman_collection.json`: The Postman collection containing all API requests
- `BondHub-Environment.postman_environment.json`: Environment variables for the collection

## Setup Instructions

1. Install [Postman](https://www.postman.com/downloads/) if you haven't already
2. Import the collection and environment files into Postman:
   - Click on "Import" in the top left corner
   - Select both JSON files or drag and drop them
3. Select the "BondHub Environment" from the environment dropdown in the top right corner
4. Make sure your BondHub backend server is running on `http://localhost:3000`

## Testing Flow

The collection is organized to follow a logical testing flow:

### Authentication

1. Start by running the "Login" requests for each user to get access tokens
   - The scripts automatically save tokens and user IDs to environment variables
2. You can test token refresh and logout functionality

### User Module

1. Test retrieving user information with various endpoints
2. Test searching for users by email or phone number

### Friend Module

1. Send friend requests between users
2. Check received and sent friend requests
3. Accept/decline friend requests
4. Test blocking and unblocking users
5. View friend relationships and friend lists

## User Accounts from Seed Data

The collection uses the following seed accounts:

1. **User 1**:
   - Email: iamhoangkhang@icloud.com
   - ID: a1a0ae5b-070f-40c2-a07d-c61c06623e7a
   - Password: sapassword

2. **User 2**:
   - Email: thanhcanh.dev@gmail.com
   - ID: cea3f6a0-b3bf-4abe-9266-7a3a6fc29173
   - Password: sapassword

3. **User 3**:
   - Email: nhutam050@gmail.com
   - ID: 43c307df-1cf7-407f-85e4-21f16a4e3bf9
   - Password: sapassword

4. **User 4**:
   - Email: bankienthanthien@gmail.com
   - ID: 1cc1b368-02e1-44a7-87c1-17ab9620bb5f
   - Password: sapassword

## Seed Data Relationships

The seed data includes the following friend relationships:

- User 1 and User 2: Friends (ACCEPTED)
- User 1 and User 3: Pending request from User 1
- User 2 and User 4: Friends (ACCEPTED)
- User 3 and User 4: Friends (ACCEPTED)
- User 4 and User 1: Pending request from User 4
- User 2 and User 3: User 2 has blocked User 3

## Notes

- The environment variables are automatically populated when you run the login requests
- Some requests depend on previous requests (like responding to a friend request)
- If you reset your database, you'll need to re-run the login requests to get fresh tokens
- The base URL is set to `http://localhost:3000/api/v1` - change this in the environment if your server runs on a different URL

## Recent Fixes

- Added UUID validation to all friend-related methods to prevent errors when invalid UUIDs are passed
- Fixed the Block User and Unblock User endpoints to properly handle UUID validation
- Added proper Content-Type headers to all requests that require them
