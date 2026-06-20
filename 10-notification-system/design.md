## Notification System

# Requriements
- whenever a usr posts a photo  
    - send notifications to all of it followers


# Basic architecture
![alt text](image.png)

Features: 
- push notifications [App, Email, SMS]
- In-app notifications [Persisted]
- Aggregation of notifications
- Notification Configurations
- Notification Decider


# Main challenge of a Noticfication System is : `FAN-OUT`

To send notifications, we use GCM, OneSignal, SNS, etc

SMS, Email are simlar to PUSH : another netowrk call

In-app updates: DB write and this needs a proepr DB modelling [Always do batch write]








