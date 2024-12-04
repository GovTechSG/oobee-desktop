# Testing 

## Functional Testing 
Functional testing was conducted for the happy flow of the desktop app for Oobee. The test cases were written using Microsoft Playwright, which is an end-to-end testing framework that has its own test runner Playwright Test. 

### How to run test cases 
1. Run the following command to build the application before running the tests. 
```
   npm run build
```

2. Run the following commands to run the all the tests in the `tests` folder,.

- Sequential 
```
   npx playwright test --worker 1 
```
- Parallel \
Currently, Oobee does not support multiple instances of the application running in parallel so running the tests in parallel will result in errors. 

```
   npx playwright test 
```

3. Run the following command to run a single test. 
```
   npx playwright test tests/{enterTestNameHere}.test.js
```