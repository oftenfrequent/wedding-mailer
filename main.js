import fs from 'fs';
import chalk from 'chalk';
import nodemailer from 'nodemailer';
import { google } from 'googleapis';

const OAuth2 = google.auth.OAuth2;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const refreshToken = process.env.REFRESH_TOKEN;
const gmailAccountAddress = process.env.FROM_EMAIL_ADDRESS;
const emailTemplate = fs.readFileSync('./email.html', 'utf8')
const guestlist = fs.readFileSync('./csv/sample.csv', 'utf8');


const testMode = process.env.MAILER_ENV === 'test';

const introAttended = `<p>This is the intro paragraph For those who attended. Notice the p tags around this content, that will separate this paragraph.</p>
<p>From this one. You can also add links using an <a href="https://qz.com" target="_blank" rel="noopener noreferrer">anchor tag.</a> Feel free to add your own stuff!</p>`;

const introDidNotAttend = `<p>This is the intro paragraph For those who were not able to attend. Notice the p tags around this content, that will separate this paragraph.</p>
<p>From this one. You can also add links using an <a href="https://qz.com" target="_blank" rel="noopener noreferrer">anchor tag.</a> Feel free to add your own stuff!</p>`;

const personalMessageDidNotAttend = `<p>This could be a generic message that is added for whatever reason.</p>`;

const arrOfFailures = [];

var main = async () => {
  let googleAuth, transporter;

  // auth with google
  try {
    googleAuth = await getGoogleAuthObject();
    console.log(chalk.green(`👍 Successfully Authenticated with Google 👍`))
  } catch (err) {
    console.log(chalk.red(`👎 Could not Authenticate with Google 👎`))
    console.log(chalk.white('Reason: '), chalk.green(`${err.response.data.error} ~ ${err.response.data.error_description}`))
    return
  }

  // create nodemailer transporter
  try {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: googleAuth,
    });
    await transporter.verify()
    console.log(chalk.green(`👍 Successfully created transporter 👍`))
  } catch (err) {
    console.log(chalk.red(`👎 Could not verify transporter 👎`))
    console.log(chalk.white('Check out the docs at', chalk.rgb(6,69,173).underline('https://nodemailer.com'), 'for more info'))
    console.log(chalk.white('Or read up on the community post connecting nodemailer with Gmail', chalk.rgb(6,69,173).underline('https://community.nodemailer.com/using-gmail/'),))
    console.log(chalk.white(`${err}`))
    return
  }

  // send emails
  try {
    await sendEmailToGuestlist(transporter);
    console.log(chalk.green(`👍 Successfully sent emails 👍`))
    return;
  } catch (err) {
    console.log(chalk.red(`👎 Something went wrong sending emails 👎`))
    console.log(chalk.white(`Error: ${err}`))
  }
}

// check if email exists at all, otherwise return falsy value
const getEmailsFromInfoArray = infoArray => {
  const email1 = infoArray[6].replace(/\s/g, '')
  const email2 = infoArray[7].replace(/\s/g, '')
  if (email1.indexOf('@') > 1) {
    // if email2 exists, return "email1, email2" else "email1"
    return email2.length ? `${email1}, ${email2}` : email1;
  }
  return '';
}

const getEmailContentFromInfoArray = infoArray => {
  const attendCount = parseInt(infoArray[5])
  if (isNaN(attendCount)) {
    console.log(chalk.white(`Could not get attendance of: ${infoArray[0]}`))
    console.log(chalk.white(`Will skip for now...`))
  } else {
    let personalMessage = (infoArray[9] && infoArray[9].length) ? infoArray[9].replace(/["]+/g, '') : ''; // strip extra quotes
    let addressTo = (infoArray[2] && infoArray[2].length) ? infoArray[2].replace(/["]+/g, '') : ''; // strip extra quotes
    let emailHTML = emailTemplate;
    // replace content
    emailHTML = emailHTML.replace(/ADDRESS_TO/g, addressTo)
    emailHTML = emailHTML.replace(/EMAIL_PREVIEW_TEXT/g,  process.env.EMAIL_PREVIEW_TEXT)
    if (attendCount > 0) {
      emailHTML = emailHTML.replace(/INTRO_MESSAGE/g, introAttended)
      if (personalMessage.length) emailHTML = emailHTML.replace(/PERSONAL_MESSAGE/g, `<p class="centered">. . .</p><p class="personal-message">${personalMessage}<p>`);
      else emailHTML = emailHTML.replace(/PERSONAL_MESSAGE/g, '');
      return emailHTML;
    } else {
      emailHTML = emailHTML.replace(/INTRO_MESSAGE/g, introDidNotAttend)
      if (personalMessage.length) emailHTML = emailHTML.replace(/PERSONAL_MESSAGE/g, `<p class="centered">. . .</p><p class="personal-message">${personalMessage}<p>`);
      else emailHTML = emailHTML.replace(/PERSONAL_MESSAGE/g, personalMessageDidNotAttend);
      return emailHTML;m
    }
  }
}


const sendEmailToGuestlist = async (transporter) => {
  // split by rows
  await guestlist.split('\n').reduce(async (promiseChain, inv) => {
    // wait for first email to send before moving on to next, and so on...
    await promiseChain.then(async () => {
      // split only on commas without spaces after
      const info = inv.split(/,(?!\s)/);
      const emailString = getEmailsFromInfoArray(info);
      console.log(chalk.blue(emailString))
      if (emailString) {
        const emailContent = getEmailContentFromInfoArray(info);
        if (testMode) {
          return await sendEmail(emailContent, process.env.TEST_EMAIL_ADDRESS, transporter);
        } else {
          // send real email
          return await sendEmail(emailContent, emailsAddressesTo, transporter);
        }

      } else {
        // there is no email to send to...
        console.log(chalk.blue(`Could not find an email address for: ${info[0]}`));
        return;
      }
    });
  }, Promise.resolve())

  if (arrOfFailures.length) {
    console.log(chalk.red(`Finished with ${arrOfFailures.length} failures:`))
    console.log(chalk.white(arrOfFailures));
  }
}

const getGoogleAuthObject = async () => {
  try {
    var oauth2Client = new OAuth2(clientId, clientSecret, 'https://developers.google.com/oauthplayground');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
  
    var tokens = await oauth2Client.refreshAccessToken();
    var accessToken = tokens.credentials.access_token;
  
    var googAuth = {
      type: 'OAuth2',
      user: gmailAccountAddress,
      clientId,
      clientSecret,
      refreshToken,
      accessToken,
    };
  
    return googAuth;
  } catch (err) {
    throw err;
  }
}

// make sending an email fault tolerant and synchronous 
const sendEmail = async (emailHTML, toEmailString, transporter) => {
  return new Promise((res, rej) => {
    var mailOptions = {
      from: `"${process.env.FROM_NAMES}" <${gmailAccountAddress}>`,
      to: toEmailString,
      subject: process.env.EMAIL_SUBJECT,
      html: emailHTML,
      text: process.env.EMAIL_PREVIEW_TEXT,
      attachments: [
        {
          filename: 'change-is-coming.jpg',
          path: './assets/change-is-coming.jpg',
          cid: 'uniqueIdForPhoto',
        }
      ],
    };

    transporter.sendMail(mailOptions, function (err, info) {
      if(err) {
        console.log(chalk.red(`Email to ${toEmailString} failed!!`))
        arrOfFailures.push(toEmailString);
        rej(err);
      } else {
        // success, just return
        console.log(info);
        res(info);
      }
    });
  });
}

main();
