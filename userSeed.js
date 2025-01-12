import bcrypt from 'bcrypt'
import connectDB from './db/DB.js';
import User from './models/User.js';


const userRegister = async ()=>{
      connectDB()
     try {
        const hashPassword= await bcrypt.hash("admin", 10)
        const newUser= new User({
            name:"Manager",
            email:"manager@gmail.com",
            password: hashPassword,
            Role:"Manager"
        })
        await newUser.save()

     } catch (error) {
        console.log(error)
     }
}
userRegister();